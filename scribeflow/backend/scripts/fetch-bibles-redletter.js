#!/usr/bin/env node
/**
 * ScribeFlow — Red-Letter Bible Fetcher
 * ══════════════════════════════════════════════════════════════════════
 *
 * Downloads USFM Bible packages from ebible.org and extracts verse text
 * with Words of Jesus marked using [[wj]]...[[/wj]] inline tokens.
 *
 * Output files (alongside existing plain-text translations):
 *   data/bibles/kjv-rl.json  — KJV Red Letter
 *   data/bibles/web-rl.json  — WEB Red Letter
 *
 * index.json is updated to include the new translations with
 * a `redLetter: true` flag so the frontend can enable the toggle.
 *
 * Source  : https://ebible.org  (USFM packages, public domain)
 * License : KJV and WEB Bible text are in the public domain.
 *
 * Usage:
 *   node scripts/fetch-bibles-redletter.js
 *   docker compose run --rm bible-fetcher-rl
 */

'use strict';

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const AdmZip   = require('adm-zip');

const OUT_DIR = path.join(__dirname, '..', 'data', 'bibles');

// Translations to fetch — id is the eBible.org USFM zip identifier
const RL_TRANSLATIONS = [
  {
    id:    'eng-kjv2006',
    label: 'KJV',
    name:  'King James Version (Red Letter)',
    out:   'kjv-rl',
  },
  {
    id:    'engWEB',
    label: 'WEB',
    name:  'World English Bible (Red Letter)',
    out:   'web-rl',
  },
];

// ── USFM book-code → ScribeFlow slug ─────────────────────────────────
const USFM_TO_SLUG = {
  GEN:'genesis',  EXO:'exodus',   LEV:'leviticus', NUM:'numbers',
  DEU:'deuteronomy', JOS:'joshua', JDG:'judges',   RUT:'ruth',
  '1SA':'1-samuel','2SA':'2-samuel','1KI':'1-kings','2KI':'2-kings',
  '1CH':'1-chronicles','2CH':'2-chronicles',
  EZR:'ezra',     NEH:'nehemiah', EST:'esther',    JOB:'job',
  PSA:'psalms',   PRO:'proverbs', ECC:'ecclesiastes',
  SNG:'song-of-solomon',
  ISA:'isaiah',   JER:'jeremiah', LAM:'lamentations',
  EZK:'ezekiel',  DAN:'daniel',   HOS:'hosea',     JOL:'joel',
  AMO:'amos',     OBA:'obadiah',  JON:'jonah',     MIC:'micah',
  NAH:'nahum',    HAB:'habakkuk', ZEP:'zephaniah', HAG:'haggai',
  ZEC:'zechariah',MAL:'malachi',
  MAT:'matthew',  MRK:'mark',     LUK:'luke',      JHN:'john',
  ACT:'acts',     ROM:'romans',
  '1CO':'1-corinthians','2CO':'2-corinthians',
  GAL:'galatians',EPH:'ephesians',PHP:'philippians',COL:'colossians',
  '1TH':'1-thessalonians','2TH':'2-thessalonians',
  '1TI':'1-timothy','2TI':'2-timothy',
  TIT:'titus',    PHM:'philemon', HEB:'hebrews',   JAS:'james',
  '1PE':'1-peter','2PE':'2-peter',
  '1JN':'1-john', '2JN':'2-john', '3JN':'3-john',
  JUD:'jude',     REV:'revelation',
};

const BOOK_NAMES = {
  'genesis':'Genesis','exodus':'Exodus','leviticus':'Leviticus',
  'numbers':'Numbers','deuteronomy':'Deuteronomy','joshua':'Joshua',
  'judges':'Judges','ruth':'Ruth','1-samuel':'1 Samuel',
  '2-samuel':'2 Samuel','1-kings':'1 Kings','2-kings':'2 Kings',
  '1-chronicles':'1 Chronicles','2-chronicles':'2 Chronicles',
  'ezra':'Ezra','nehemiah':'Nehemiah','esther':'Esther','job':'Job',
  'psalms':'Psalms','proverbs':'Proverbs','ecclesiastes':'Ecclesiastes',
  'song-of-solomon':'Song of Solomon','isaiah':'Isaiah',
  'jeremiah':'Jeremiah','lamentations':'Lamentations',
  'ezekiel':'Ezekiel','daniel':'Daniel','hosea':'Hosea','joel':'Joel',
  'amos':'Amos','obadiah':'Obadiah','jonah':'Jonah','micah':'Micah',
  'nahum':'Nahum','habakkuk':'Habakkuk','zephaniah':'Zephaniah',
  'haggai':'Haggai','zechariah':'Zechariah','malachi':'Malachi',
  'matthew':'Matthew','mark':'Mark','luke':'Luke','john':'John',
  'acts':'Acts','romans':'Romans',
  '1-corinthians':'1 Corinthians','2-corinthians':'2 Corinthians',
  'galatians':'Galatians','ephesians':'Ephesians',
  'philippians':'Philippians','colossians':'Colossians',
  '1-thessalonians':'1 Thessalonians','2-thessalonians':'2 Thessalonians',
  '1-timothy':'1 Timothy','2-timothy':'2 Timothy',
  'titus':'Titus','philemon':'Philemon','hebrews':'Hebrews',
  'james':'James','1-peter':'1 Peter','2-peter':'2 Peter',
  '1-john':'1 John','2-john':'2 John','3-john':'3 John',
  'jude':'Jude','revelation':'Revelation',
};

// ── HTTP ──────────────────────────────────────────────────────────────

function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ScribeFlow-BibleFetcher-RL/1.0)',
        'Accept': 'application/zip, application/octet-stream, */*',
      },
      timeout: 60000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(httpGetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── USFM PARSER ───────────────────────────────────────────────────────

/**
 * Convert a raw verse text fragment from USFM to plain text, converting
 * \wj...\wj* markers to [[wj]]...[[/wj]] tokens and stripping everything else.
 */
function cleanVerseText(raw) {
  return raw
    // Protect wj markers first
    .replace(/\\wj\*/g,  '[[/wj]]')
    .replace(/\\wj\b/g,  '[[wj]]')
    // Strip all remaining USFM inline markers (e.g. \nd, \add, \it, \sc, \+nd)
    .replace(/\\\+?\w+\*?\s*/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a USFM text (single book file) and return:
 *   { bookSlug, chapters: { 1: [{verse, text}], ... } }
 */
function parseUsfmBook(content) {
  const lines = content.split(/\r?\n/);

  let bookSlug      = null;
  let currentChapter = 0;
  let currentVerse   = 0;
  let currentText    = '';
  const chapters     = {};

  function saveVerse() {
    if (!bookSlug || currentChapter < 1 || currentVerse < 1) return;
    const text = cleanVerseText(currentText);
    if (!text) return;
    if (!chapters[currentChapter]) chapters[currentChapter] = [];
    chapters[currentChapter].push({ verse: currentVerse, text });
    currentText = '';
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Book identifier
    if (line.startsWith('\\id ')) {
      const code = line.slice(4, 7).trim().toUpperCase();
      bookSlug = USFM_TO_SLUG[code] || null;
      continue;
    }

    if (!bookSlug) continue;

    // Chapter marker
    if (/^\\c\s+\d/.test(line)) {
      saveVerse();
      currentChapter = parseInt(line.match(/\\c\s+(\d+)/)[1]);
      currentVerse   = 0;
      continue;
    }

    // Verse marker (may have inline text on the same line)
    if (/^\\v\s+\d/.test(line)) {
      saveVerse();
      const m = line.match(/^\\v\s+(\d+)\s*(.*)/);
      currentVerse = parseInt(m[1]);
      currentText  = m[2] || '';
      continue;
    }

    // Continuation of current verse (non-marker lines or paragraph markers)
    if (currentVerse > 0) {
      if (line.startsWith('\\c ') || line.startsWith('\\s') ||
          line.startsWith('\\ms') || line.startsWith('\\mr') ||
          line.startsWith('\\r ')) {
        // Section headings etc. — don't append to verse text
        continue;
      }
      // Append; strip leading standalone paragraph markers (\p, \q, \m, etc.)
      const stripped = line.replace(/^\\[pqmPQM]\d?\s*/, '');
      currentText += ' ' + stripped;
    }
  }
  saveVerse();

  return { bookSlug, chapters };
}

// ── BUILD BIBLE OBJECT ────────────────────────────────────────────────

function buildBibleFromZip(zipBuffer, trans) {
  const zip  = new AdmZip(zipBuffer);
  const bible = {
    id:        trans.out,
    label:     trans.label,
    name:      trans.name,
    redLetter: true,
    books:     {},
  };

  // Initialise all books
  for (const slug of Object.values(USFM_TO_SLUG)) {
    if (!bible.books[slug]) {
      bible.books[slug] = { name: BOOK_NAMES[slug] || slug, chapters: {} };
    }
  }

  const entries = zip.getEntries().filter(e =>
    !e.isDirectory && e.entryName.match(/\.(usfm|sfm)$/i)
  );

  console.log(`  Found ${entries.length} USFM file(s) in zip`);

  for (const entry of entries) {
    const content = entry.getData().toString('utf8');
    const { bookSlug, chapters } = parseUsfmBook(content);
    if (!bookSlug) continue;
    if (!bible.books[bookSlug]) {
      bible.books[bookSlug] = { name: BOOK_NAMES[bookSlug] || bookSlug, chapters: {} };
    }
    bible.books[bookSlug].chapters = chapters;
  }

  return bible;
}

// ── INDEX ─────────────────────────────────────────────────────────────

function updateIndex() {
  const indexFile = path.join(OUT_DIR, 'index.json');
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}

  // Remove stale rl entries, then re-add from actual files
  existing = existing.filter(t => !t.redLetter);

  for (const trans of RL_TRANSLATIONS) {
    const f = path.join(OUT_DIR, trans.out + '.json');
    if (!fs.existsSync(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (data && typeof data.books === 'object') {
        existing.push({ id: trans.out, label: trans.label, name: trans.name, redLetter: true });
      }
    } catch {}
  }

  fs.writeFileSync(indexFile, JSON.stringify(existing, null, 2));
  console.log(`  index.json updated — ${existing.length} translation(s) total`);
}

// ── MAIN ──────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log('  ScribeFlow Red-Letter Bible Fetcher');
  console.log('  Source  : ebible.org (USFM packages)');
  console.log('  Markers : [[wj]]...[[/wj]] inline tokens');
  console.log(line + '\n');

  for (const trans of RL_TRANSLATIONS) {
    const outFile = path.join(OUT_DIR, trans.out + '.json');
    const url     = `https://ebible.org/Scriptures/${trans.id}_usfm.zip`;

    console.log(`\n  ── ${trans.label}  ${trans.name}`);

    if (fs.existsSync(outFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const bookCount = Object.values(data.books || {})
          .filter(b => Object.keys(b.chapters || {}).length > 0).length;
        if (bookCount >= 60) {
          const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
          console.log(`  ✓  Already complete — ${bookCount} books, ${mb} MB`);
          continue;
        }
      } catch {}
    }

    console.log(`  Downloading: ${url}`);
    let zipBuffer;
    try {
      zipBuffer = await httpGetBuffer(url);
    } catch (err) {
      console.error(`  ✗  Download failed: ${err.message}`);
      continue;
    }
    console.log(`  Download complete (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB) — parsing USFM…`);

    let bible;
    try {
      bible = buildBibleFromZip(zipBuffer, trans);
    } catch (err) {
      console.error(`  ✗  Parse failed: ${err.message}`);
      continue;
    }

    const bookCount = Object.values(bible.books)
      .filter(b => Object.keys(b.chapters).length > 0).length;
    console.log(`  Parsed ${bookCount} books`);

    fs.writeFileSync(outFile, JSON.stringify(bible));
    const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    console.log(`  ✓  Saved ${trans.out}.json (${mb} MB)`);
  }

  updateIndex();

  console.log('\n' + line);
  console.log('  Done. Run the main app to use red-letter translations.');
  console.log(line + '\n');
}

main().catch(err => {
  console.error('\nFatal error: ' + err.message);
  process.exit(1);
});
