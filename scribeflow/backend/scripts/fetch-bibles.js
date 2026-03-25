#!/usr/bin/env node
/**
 * ScribeFlow — Bible Data Fetcher  (v6)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Fetches complete public-domain Bible translations from bible-api.com
 * using its standard text API:
 *
 *   https://bible-api.com/{book}+{chapter}?translation={id}
 *   e.g. https://bible-api.com/genesis+1?translation=kjv
 *
 * Returns { verses: [{verse, text, ...}] } per chapter request.
 * The previous /data/ parameterized endpoint returned HTTP 404.
 *
 * On every run:
 *   1. Audits translation files already on disk
 *   2. Identifies missing/empty chapters
 *   3. Re-fetches ONLY those chapters
 *   4. Patches data in-place and rewrites index.json
 *
 * Source  : https://bible-api.com  (github.com/timmorgan/bible-api)
 * License : Bible text is public domain for all included translations
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

const OUT_DIR  = path.join(__dirname, '..', 'data', 'bibles');
const BASE_URL = 'https://bible-api.com';

const TRANSLATIONS = [
  { id: 'kjv',   label: 'KJV',   name: 'King James Version' },
  { id: 'asv',   label: 'ASV',   name: 'American Standard Version' },
  { id: 'web',   label: 'WEB',   name: 'World English Bible' },
  { id: 'bbe',   label: 'BBE',   name: 'Bible in Basic English' },
  { id: 'ylt',   label: 'YLT',   name: "Young's Literal Translation" },
  { id: 'darby', label: 'Darby', name: 'Darby Translation' },
];

// Internal slug -> 3-letter book ID used by bible-api.com parameterized API
// No spaces anywhere — completely avoids %20 encoding issues
const BOOK_IDS = {
  'genesis':'GEN','exodus':'EXO','leviticus':'LEV','numbers':'NUM',
  'deuteronomy':'DEU','joshua':'JOS','judges':'JDG','ruth':'RUT',
  '1-samuel':'1SA','2-samuel':'2SA','1-kings':'1KI','2-kings':'2KI',
  '1-chronicles':'1CH','2-chronicles':'2CH','ezra':'EZR','nehemiah':'NEH',
  'esther':'EST','job':'JOB','psalms':'PSA','proverbs':'PRO',
  'ecclesiastes':'ECC','song-of-solomon':'SNG','isaiah':'ISA',
  'jeremiah':'JER','lamentations':'LAM','ezekiel':'EZK','daniel':'DAN',
  'hosea':'HOS','joel':'JOL','amos':'AMO','obadiah':'OBA','jonah':'JON',
  'micah':'MIC','nahum':'NAH','habakkuk':'HAB','zephaniah':'ZEP',
  'haggai':'HAG','zechariah':'ZEC','malachi':'MAL',
  'matthew':'MAT','mark':'MRK','luke':'LUK','john':'JHN','acts':'ACT',
  'romans':'ROM','1-corinthians':'1CO','2-corinthians':'2CO',
  'galatians':'GAL','ephesians':'EPH','philippians':'PHP','colossians':'COL',
  '1-thessalonians':'1TH','2-thessalonians':'2TH','1-timothy':'1TI',
  '2-timothy':'2TI','titus':'TIT','philemon':'PHM','hebrews':'HEB',
  'james':'JAS','1-peter':'1PE','2-peter':'2PE','1-john':'1JN',
  '2-john':'2JN','3-john':'3JN','jude':'JUD','revelation':'REV',
};

const BOOKS = Object.keys(BOOK_IDS);

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

const TOTAL_CHAPTERS = Object.values(CHAPTER_COUNTS).reduce((a, b) => a + b, 0);

// ── HTTP ─────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const parsed = require('url').parse(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.path,
      method:   'GET',
      timeout:  30000,
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; ScribeFlow-BibleFetcher/1.6)',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control':   'no-cache',
        'Connection':      'keep-alive',
      }
    };
    const req = client.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const zlib     = require('zlib');
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if      (encoding === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br')      stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      stream.on('data',  c => chunks.push(c));
      stream.on('end',   () => {
        try   { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
      stream.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Build the standard text-based chapter URL.
// e.g. https://bible-api.com/genesis+1?translation=kjv
//      https://bible-api.com/1+samuel+1?translation=kjv
// Returns { verses: [{verse, text, ...}] } — same structure the rest of
// the script already expects.
function chapterUrl(bookSlug, chapter, translationId) {
  const bookName = BOOK_NAMES[bookSlug].toLowerCase().replace(/ /g, '+');
  return BASE_URL + '/' + bookName + '+' + chapter + '?translation=' + translationId;
}

// ── AUDIT ─────────────────────────────────────────────────────────────────

function auditTranslation(t) {
  const filePath = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
  let bible = null;

  if (fs.existsSync(filePath)) {
    try {
      bible = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn('  [WARN] ' + t.label + ': file unreadable (' + e.message + ') — rebuilding');
    }
  }

  if (!bible || typeof bible.books !== 'object') {
    bible = { id: t.id, label: t.label, name: t.name, books: {} };
  }

  for (const book of BOOKS) {
    if (!bible.books[book] || typeof bible.books[book] !== 'object') {
      bible.books[book] = { name: BOOK_NAMES[book], chapters: {} };
    }
    if (typeof bible.books[book].chapters !== 'object') {
      bible.books[book].chapters = {};
    }
  }

  const gaps = [];
  for (const book of BOOKS) {
    const stored = bible.books[book].chapters;
    for (let ch = 1; ch <= CHAPTER_COUNTS[book]; ch++) {
      const d = stored[ch];
      if (!d || !Array.isArray(d) || d.length === 0) gaps.push({ book, chapter: ch });
    }
  }

  return { bible, gaps, filePath };
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function toRanges(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const out = [];
  let start = s[0], prev = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === prev + 1) { prev = s[i]; continue; }
    out.push(start === prev ? String(start) : start + '-' + prev);
    if (i < s.length) { start = s[i]; prev = s[i]; }
  }
  return out.join(', ');
}

function progress(done, total, label) {
  const pct  = total ? Math.floor(done / total * 100) : 100;
  const fill = Math.floor(pct / 2);
  const bar  = '[' + '\u2588'.repeat(fill) + '\u2591'.repeat(50 - fill) + ']';
  process.stdout.write('\r  ' + bar + ' ' + String(pct).padStart(3) + '%  ' + label.padEnd(28, ' '));
}

// ── PROCESS ONE TRANSLATION ──────────────────────────────────────────────

async function processTranslation(t) {
  console.log('\n  \u2500\u2500 ' + t.label + '  ' + t.name);

  const { bible, gaps, filePath } = auditTranslation(t);

  if (gaps.length === 0) {
    const mb = fs.existsSync(filePath)
      ? ' (' + (fs.statSync(filePath).size / 1024 / 1024).toFixed(1) + ' MB)' : '';
    console.log('  \u2713  Complete \u2014 all ' + TOTAL_CHAPTERS + ' chapters present' + mb);
    return { fetched: 0, failed: 0 };
  }

  const byBook = {};
  for (const g of gaps) { (byBook[g.book] = byBook[g.book] || []).push(g.chapter); }
  console.log('  \u2717  ' + gaps.length + ' gap(s) in ' + Object.keys(byBook).length + ' book(s):');
  for (const book of BOOKS) {
    if (!byBook[book]) continue;
    console.log('       ' + BOOK_NAMES[book].padEnd(24) + 'ch. ' + toRanges(byBook[book]));
  }
  console.log('  Fetching\u2026');

  let fetched = 0, failed = 0;

  for (let i = 0; i < gaps.length; i++) {
    const { book, chapter } = gaps[i];
    progress(i, gaps.length, BOOK_NAMES[book] + ' ' + chapter);

    let retries = 5, backoff = 800;
    while (retries > 0) {
      try {
        const url  = chapterUrl(book, chapter, t.id);
        const data = await httpGet(url);

        // Parameterized API returns { verses: [{verse_id, book_id, chapter, verse, text}] }
        const verses = Array.isArray(data.verses) ? data.verses : [];
        if (verses.length === 0) throw new Error('Empty response');

        bible.books[book].chapters[chapter] = verses.map(v => ({
          verse: v.verse,
          text:  (v.text || '').trim(),
        }));
        await sleep(120);
        fetched++;
        break;
      } catch (err) {
        retries--;
        if (retries === 0) {
          process.stdout.write('\n');
          console.warn('  [WARN] ' + t.label + ' ' + BOOK_NAMES[book] + ' ' + chapter + ': ' + err.message);
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
    console.log('  \u2713  ' + fetched + ' chapter(s) saved \u2014 ' + mb + ' MB');
  } else {
    console.log('  \u26A0  ' + fetched + ' fetched, ' + failed + ' still empty \u2014 re-run to retry');
  }
  return { fetched, failed };
}

// ── WRITE INDEX ──────────────────────────────────────────────────────────

function writeIndex() {
  const index = TRANSLATIONS
    .filter(t => {
      const f = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
      if (!fs.existsSync(f)) return false;
      try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d && typeof d.books === 'object'; }
      catch (e) { return false; }
    })
    .map(t => ({ id: t.label.toLowerCase(), label: t.label, name: t.name }));
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  return index.length;
}

// ── MAIN ─────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log('  ScribeFlow Bible Fetcher');
  console.log('  Source  : bible-api.com (text API, book+chapter?translation=id)');
  console.log('  Output  : ' + OUT_DIR);
  console.log('  Books   : ' + BOOKS.length + '  *  Chapters : ' + TOTAL_CHAPTERS);
  console.log(line);
  console.log('\n  Auditing existing files...\n');

  const work = [];
  for (const t of TRANSLATIONS) {
    const fp     = path.join(OUT_DIR, t.label.toLowerCase() + '.json');
    const exists = fs.existsSync(fp);
    const { gaps } = auditTranslation(t);
    work.push({ t, gaps });
    const icon   = (gaps.length === 0 && exists) ? '\u2713' : '\u2717';
    const status = !exists ? 'not downloaded yet'
                 : gaps.length === 0 ? 'complete  (' + (fs.statSync(fp).size/1024/1024).toFixed(1) + ' MB)'
                 : gaps.length + ' chapter(s) missing or empty';
    console.log('  ' + icon + '  ' + t.label.padEnd(7) + status);
  }

  const totalGaps = work.reduce((n, r) => n + r.gaps.length, 0);
  if (totalGaps === 0) {
    console.log('\n' + line);
    console.log('  All translations complete. Nothing to fetch.');
    console.log(line + '\n');
    writeIndex();
    return;
  }

  const needWork = work.filter(r => r.gaps.length > 0);
  console.log('\n  ' + totalGaps + ' gap(s) across ' + needWork.length + ' translation(s).');

  let totalFetched = 0, totalFailed = 0;
  for (const { t } of needWork) {
    try {
      const r = await processTranslation(t);
      totalFetched += r.fetched;
      totalFailed  += r.failed;
    } catch (err) {
      console.error('\n  [ERROR] ' + t.label + ': ' + err.message);
      totalFailed++;
    }
  }

  const indexCount = writeIndex();
  console.log('\n' + line);
  console.log('  Run complete.');
  console.log('  Chapters fetched   : ' + totalFetched);
  if (totalFailed > 0)
    console.log('  Still incomplete   : ' + totalFailed + ' \u2014 re-run to retry');
  else
    console.log('  All gaps filled.');
  console.log('  Translations ready : ' + indexCount + ' / ' + TRANSLATIONS.length);
  console.log(line + '\n');
}

main().catch(err => { console.error('\nFatal error: ' + err.message); process.exit(1); });
