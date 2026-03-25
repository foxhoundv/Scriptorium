#!/usr/bin/env node
/**
 * ScribeFlow — Bible Data Fetcher  (v2)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * On every run this script:
 *   1. Audits each translation file already on disk
 *   2. Identifies every missing book, missing chapter, or chapter stored
 *      as an empty array (i.e. a previously failed fetch)
 *   3. Re-fetches ONLY those specific chapters — nothing complete is
 *      touched or re-downloaded
 *   4. Patches the data back to disk in-place
 *   5. Rebuilds index.json listing only fully-present translations
 *
 * Source : https://github.com/wldeh/bible-api  (jsDelivr CDN)
 * License: MIT (code). All Bible text is public domain.
 *
 * Usage:
 *   node scripts/fetch-bibles.js
 *   docker compose run --rm bible-fetcher
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data', 'bibles');
const CDN     = 'https://cdn.jsdelivr.net/gh/wldeh/bible-api@main/bibles';

const TRANSLATIONS = [
  { id: 'en-kjv',   label: 'KJV',   name: 'King James Version' },
  { id: 'en-asv',   label: 'ASV',   name: 'American Standard Version' },
  { id: 'en-web',   label: 'WEB',   name: 'World English Bible' },
  { id: 'en-bbe',   label: 'BBE',   name: 'Bible in Basic English' },
  { id: 'en-ylt',   label: 'YLT',   name: "Young's Literal Translation" },
  { id: 'en-darby', label: 'Darby', name: 'Darby Translation' },
];

const BOOKS = [
  'genesis','exodus','leviticus','numbers','deuteronomy',
  'joshua','judges','ruth','1-samuel','2-samuel',
  '1-kings','2-kings','1-chronicles','2-chronicles',
  'ezra','nehemiah','esther','job','psalms','proverbs',
  'ecclesiastes','song-of-solomon','isaiah','jeremiah',
  'lamentations','ezekiel','daniel','hosea','joel','amos',
  'obadiah','jonah','micah','nahum','habakkuk','zephaniah',
  'haggai','zechariah','malachi',
  'matthew','mark','luke','john','acts',
  'romans','1-corinthians','2-corinthians','galatians',
  'ephesians','philippians','colossians',
  '1-thessalonians','2-thessalonians',
  '1-timothy','2-timothy','titus','philemon',
  'hebrews','james','1-peter','2-peter',
  '1-john','2-john','3-john','jude','revelation',
];

const BOOK_NAMES = {
  'genesis':'Genesis','exodus':'Exodus','leviticus':'Leviticus',
  'numbers':'Numbers','deuteronomy':'Deuteronomy','joshua':'Joshua',
  'judges':'Judges','ruth':'Ruth','1-samuel':'1 Samuel',
  '2-samuel':'2 Samuel','1-kings':'1 Kings','2-kings':'2 Kings',
  '1-chronicles':'1 Chronicles','2-chronicles':'2 Chronicles',
  'ezra':'Ezra','nehemiah':'Nehemiah','esther':'Esther','job':'Job',
  'psalms':'Psalms','proverbs':'Proverbs','ecclesiastes':'Ecclesiastes',
  'song-of-solomon':'Song of Solomon','isaiah':'Isaiah',
  'jeremiah':'Jeremiah','lamentations':'Lamentations','ezekiel':'Ezekiel',
  'daniel':'Daniel','hosea':'Hosea','joel':'Joel','amos':'Amos',
  'obadiah':'Obadiah','jonah':'Jonah','micah':'Micah','nahum':'Nahum',
  'habakkuk':'Habakkuk','zephaniah':'Zephaniah','haggai':'Haggai',
  'zechariah':'Zechariah','malachi':'Malachi',
  'matthew':'Matthew','mark':'Mark','luke':'Luke','john':'John',
  'acts':'Acts','romans':'Romans','1-corinthians':'1 Corinthians',
  '2-corinthians':'2 Corinthians','galatians':'Galatians',
  'ephesians':'Ephesians','philippians':'Philippians',
  'colossians':'Colossians','1-thessalonians':'1 Thessalonians',
  '2-thessalonians':'2 Thessalonians','1-timothy':'1 Timothy',
  '2-timothy':'2 Timothy','titus':'Titus','philemon':'Philemon',
  'hebrews':'Hebrews','james':'James','1-peter':'1 Peter',
  '2-peter':'2 Peter','1-john':'1 John','2-john':'2 John',
  '3-john':'3 John','jude':'Jude','revelation':'Revelation',
};

const CHAPTER_COUNTS = {
  'genesis':50,'exodus':40,'leviticus':27,'numbers':36,'deuteronomy':34,
  'joshua':24,'judges':21,'ruth':4,'1-samuel':31,'2-samuel':24,
  '1-kings':22,'2-kings':25,'1-chronicles':29,'2-chronicles':36,
  'ezra':10,'nehemiah':13,'esther':10,'job':42,'psalms':150,'proverbs':31,
  'ecclesiastes':12,'song-of-solomon':8,'isaiah':66,'jeremiah':52,
  'lamentations':5,'ezekiel':48,'daniel':12,'hosea':14,'joel':3,'amos':9,
  'obadiah':1,'jonah':4,'micah':7,'nahum':3,'habakkuk':3,'zephaniah':3,
  'haggai':2,'zechariah':14,'malachi':4,
  'matthew':28,'mark':16,'luke':24,'john':21,'acts':28,
  'romans':16,'1-corinthians':16,'2-corinthians':13,'galatians':6,
  'ephesians':6,'philippians':4,'colossians':4,
  '1-thessalonians':5,'2-thessalonians':3,
  '1-timothy':6,'2-timothy':4,'titus':3,'philemon':1,
  'hebrews':13,'james':5,'1-peter':5,'2-peter':3,
  '1-john':5,'2-john':1,'3-john':1,'jude':1,'revelation':22,
};

const TOTAL_CHAPTERS = Object.values(CHAPTER_COUNTS).reduce((a, b) => a + b, 0); // 1,189

// ── CDN SLUG PROBING ─────────────────────────────────────────────────────
// The CDN's actual folder names for numbered/multi-word books are not always
// the same as our internal hyphenated slugs.  We probe on first use and
// cache the working format so every subsequent chapter uses it immediately.
//
// Candidates tried in order for any slug that starts with a digit or
// contains a hyphen:
//   1. Original slug as-is          e.g.  1-samuel
//   2. Digit fused, rest hyphened   e.g.  1samuel     (no hyphen after digit)
//   3. All hyphens removed          e.g.  1samuel → same as #2 for most
//   4. Written-out ordinal          e.g.  first-samuel
//
// For song-of-solomon specifically we also try:
//   songofsolomon, song-of-solomon (original)
//
// The first variant that returns HTTP 200 is cached and used for every
// remaining chapter of that book.

const ORDINALS = ['first','second','third'];

function slugVariants(slug) {
  const variants = [slug]; // always try original first

  // Digit-prefixed books: try fusing the number to the rest
  const digitMatch = slug.match(/^(\d+)-(.+)$/);
  if (digitMatch) {
    const num  = digitMatch[1];
    const rest = digitMatch[2];
    variants.push(num + rest);                          // e.g. 1samuel
    variants.push(num + '-' + rest.replace(/-/g, ''));  // e.g. 1-samuel (same as orig — dedupe below)
    const ordinal = ORDINALS[parseInt(num) - 1];
    if (ordinal) {
      variants.push(ordinal + '-' + rest);              // e.g. first-samuel
      variants.push(ordinal + rest);                    // e.g. firstsamuel
    }
  }

  // Multi-word books: also try with all hyphens removed
  if (slug.includes('-')) {
    variants.push(slug.replace(/-/g, ''));              // e.g. songofsolomon
  }

  // Deduplicate while preserving order
  return variants.filter((v, i, a) => a.indexOf(v) === i);
}

// Per-translation cache: slug -> resolved CDN path segment
// Populated on first successful fetch of each book.
const cdnSlugCache = {};

// ── HTTP ─────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── AUDIT ─────────────────────────────────────────────────────────────────
// Returns { bible, gaps, filePath }
// bible — parsed object or fresh skeleton
// gaps  — array of { book, chapter } that are missing or empty

function auditTranslation(t) {
  const filePath = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
  let bible = null;

  if (fs.existsSync(filePath)) {
    try {
      bible = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn('  [WARN] ' + t.label + ': file unreadable (' + e.message + ') — rebuilding');
      bible = null;
    }
  }

  // Fresh skeleton if nothing usable on disk
  if (!bible || typeof bible.books !== 'object') {
    bible = { id: t.id, label: t.label, name: t.name, books: {} };
  }

  // Ensure every expected book structure exists
  for (const book of BOOKS) {
    if (!bible.books[book] || typeof bible.books[book] !== 'object') {
      bible.books[book] = { name: BOOK_NAMES[book], chapters: {} };
    }
    if (typeof bible.books[book].chapters !== 'object') {
      bible.books[book].chapters = {};
    }
  }

  // Collect every chapter that is missing or was stored as empty []
  const gaps = [];
  for (const book of BOOKS) {
    const expected = CHAPTER_COUNTS[book];
    const stored   = bible.books[book].chapters;
    for (let ch = 1; ch <= expected; ch++) {
      const data = stored[ch];
      if (!data || !Array.isArray(data) || data.length === 0) {
        gaps.push({ book, chapter: ch });
      }
    }
  }

  return { bible, gaps, filePath };
}

// ── RANGE SUMMARY ────────────────────────────────────────────────────────
// Converts [1,2,3,7,8,12] → "1-3, 7-8, 12"

function toRanges(nums) {
  if (!nums.length) return '';
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    ranges.push(start === prev ? String(start) : start + '-' + prev);
    if (i < sorted.length) { start = sorted[i]; prev = sorted[i]; }
  }
  return ranges.join(', ');
}

// ── PROGRESS BAR ─────────────────────────────────────────────────────────

function progress(done, total, label) {
  const pct  = total ? Math.floor(done / total * 100) : 100;
  const fill = Math.floor(pct / 2);
  const bar  = '[' + '\u2588'.repeat(fill) + '\u2591'.repeat(50 - fill) + ']';
  process.stdout.write('\r  ' + bar + ' ' + String(pct).padStart(3) + '%  ' + label.padEnd(28, ' '));
}

// ── PROCESS ONE TRANSLATION ──────────────────────────────────────────────

async function processTranslation(t) {
  console.log('\n  \u2500\u2500 ' + t.label + '  ' + t.name + '  ' + '\u2500'.repeat(Math.max(0, 40 - t.name.length)));

  const { bible, gaps, filePath } = auditTranslation(t);

  // Nothing to do
  if (gaps.length === 0) {
    const mb = fs.existsSync(filePath)
      ? ' (' + (fs.statSync(filePath).size / 1024 / 1024).toFixed(1) + ' MB)'
      : '';
    console.log('  \u2713  Complete \u2014 all ' + TOTAL_CHAPTERS + ' chapters present' + mb);
    return { fetched: 0, failed: 0 };
  }

  // Report gaps
  const byBook = {};
  for (const g of gaps) {
    (byBook[g.book] = byBook[g.book] || []).push(g.chapter);
  }
  const bookCount = Object.keys(byBook).length;
  console.log('  \u2717  ' + gaps.length + ' chapter(s) missing/empty in ' + bookCount + ' book(s):');
  for (const book of BOOKS) {
    if (!byBook[book]) continue;
    console.log('       ' + BOOK_NAMES[book].padEnd(24) + 'ch. ' + toRanges(byBook[book]));
  }
  console.log('  Fetching\u2026');

  // Fetch every gap
  let fetched = 0;
  let failed  = 0;

  for (let i = 0; i < gaps.length; i++) {
    const { book, chapter } = gaps[i];
    progress(i, gaps.length, BOOK_NAMES[book] + ' ' + chapter);

    // Resolve CDN slug (probe on first use of each book, then use cache)
    const cacheKey = t.id + ':' + book;
    if (!cdnSlugCache[cacheKey]) {
      const candidates = slugVariants(book);
      let resolved = null;
      for (const candidate of candidates) {
        const probeUrl = CDN + '/' + t.id + '/books/' + candidate + '/chapters/1.json';
        try {
          await httpGet(probeUrl);
          resolved = candidate;
          if (candidate !== book) {
            process.stdout.write('\n');
            console.log('  [PROBE] ' + BOOK_NAMES[book] + ': CDN uses "' + candidate + '" (not "' + book + '")');
          }
          break;
        } catch (e) {
          // try next candidate
        }
      }
      cdnSlugCache[cacheKey] = resolved || book; // fall back to original if nothing worked
    }
    const cdnSlug = cdnSlugCache[cacheKey];

    let retries = 5;
    let backoff = 600;

    while (retries > 0) {
      try {
        const url    = CDN + '/' + t.id + '/books/' + cdnSlug + '/chapters/' + chapter + '.json';
        const data   = await httpGet(url);
        const verses = Array.isArray(data.verses) ? data.verses
                     : Array.isArray(data)        ? data
                     : [];
        bible.books[book].chapters[chapter] = verses.map(function(v) {
          return { verse: v.verse, text: (v.text || '').trim() };
        });
        await sleep(25);
        fetched++;
        break;
      } catch (err) {
        retries--;
        if (retries === 0) {
          process.stdout.write('\n');
          console.warn('  [WARN] ' + t.label + ' ' + BOOK_NAMES[book] + ' ' + chapter + ': ' + err.message + ' \u2014 will retry next run');
          bible.books[book].chapters[chapter] = [];
          failed++;
        } else {
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 8000);
        }
      }
    }
  }

  progress(gaps.length, gaps.length, 'Saving\u2026');
  fs.writeFileSync(filePath, JSON.stringify(bible));
  const mb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  process.stdout.write('\n');

  if (failed === 0) {
    console.log('  \u2713  ' + fetched + ' chapter(s) saved \u2014 ' + mb + ' MB  (' + t.name + ' complete)');
  } else {
    console.log('  \u26A0  ' + fetched + ' fetched, ' + failed + ' still empty \u2014 re-run to retry');
  }

  return { fetched, failed };
}

// ── WRITE INDEX ──────────────────────────────────────────────────────────

function writeIndex() {
  const index = TRANSLATIONS
    .filter(function(t) {
      const f = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
      if (!fs.existsSync(f)) return false;
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        return d && typeof d.books === 'object';
      } catch (e) { return false; }
    })
    .map(function(t) {
      return { id: t.label.toLowerCase(), label: t.label, name: t.name };
    });

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  return index.length;
}

// ── MAIN ─────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log('  ScribeFlow Bible Fetcher  (audit + selective repair)');
  console.log('  Source  : cdn.jsdelivr.net / github.com/wldeh/bible-api');
  console.log('  Output  : ' + OUT_DIR);
  console.log('  Books   : ' + BOOKS.length + '  *  Chapters per translation : ' + TOTAL_CHAPTERS);
  console.log(line);

  // ── Phase 1: Audit all translations ──────────────────────────────────
  console.log('\n  Auditing existing files...\n');

  const work = [];
  for (const t of TRANSLATIONS) {
    const filePath = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
    const exists   = fs.existsSync(filePath);
    const { gaps } = auditTranslation(t);
    work.push({ t, gaps, exists });

    const statusIcon = (gaps.length === 0 && exists) ? '\u2713' : '\u2717';
    const statusText = !exists
      ? 'not downloaded yet'
      : gaps.length === 0
        ? 'complete  (' + (fs.statSync(filePath).size / 1024 / 1024).toFixed(1) + ' MB)'
        : gaps.length + ' chapter(s) missing or empty';

    console.log('  ' + statusIcon + '  ' + t.label.padEnd(7) + statusText);
  }

  const totalGaps = work.reduce(function(n, r) { return n + r.gaps.length; }, 0);

  if (totalGaps === 0) {
    console.log('\n' + line);
    console.log('  All translations are complete. Nothing to fetch.');
    console.log(line + '\n');
    writeIndex();
    return;
  }

  const needWork = work.filter(function(r) { return r.gaps.length > 0; });
  console.log('\n  ' + totalGaps + ' total gap(s) across ' + needWork.length + ' translation(s). Starting fetch...');

  // ── Phase 2: Fetch only what is needed ───────────────────────────────
  let totalFetched = 0;
  let totalFailed  = 0;

  for (const { t } of needWork) {
    try {
      const result = await processTranslation(t);
      totalFetched += result.fetched;
      totalFailed  += result.failed;
    } catch (err) {
      console.error('\n  [ERROR] ' + t.label + ': ' + err.message);
      totalFailed++;
    }
  }

  // ── Final report ──────────────────────────────────────────────────────
  const indexCount = writeIndex();
  console.log('\n' + line);
  console.log('  Run complete.');
  console.log('  Chapters fetched   : ' + totalFetched);
  if (totalFailed > 0) {
    console.log('  Still incomplete   : ' + totalFailed + ' chapter(s) \u2014 re-run to retry');
  } else {
    console.log('  All gaps filled    : all translations now complete');
  }
  console.log('  Translations ready : ' + indexCount + ' / ' + TRANSLATIONS.length);
  console.log(line + '\n');
}

main().catch(function(err) {
  console.error('\nFatal error: ' + err.message);
  process.exit(1);
});
