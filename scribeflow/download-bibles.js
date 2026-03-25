#!/usr/bin/env node
/**
 * ScribeFlow — Bible Data Downloader
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SOURCE:
 *   GitHub repo : https://github.com/wldeh/bible-api
 *   CDN host    : https://cdn.jsdelivr.net (jsDelivr)
 *   License     : MIT (code). Bible text is public domain for all
 *                 translations included here.
 *
 * WHAT THIS DOWNLOADS:
 *   Six complete public-domain Bible translations, book by book,
 *   chapter by chapter, saved as a single JSON file per translation.
 *
 *   ID          Label   Full name
 *   ─────────── ─────── ──────────────────────────────────
 *   en-kjv      KJV     King James Version (1769)
 *   en-asv      ASV     American Standard Version (1901)
 *   en-web      WEB     World English Bible (modern, public domain)
 *   en-bbe      BBE     Bible in Basic English (1949/1964)
 *   en-ylt      YLT     Young's Literal Translation (1898)
 *   en-darby    Darby   Darby Translation (1890)
 *
 * OUTPUT FILES (placed in ./bibles/ relative to this script):
 *   bibles/kjv.json       ~4–5 MB each
 *   bibles/asv.json
 *   bibles/web.json
 *   bibles/bbe.json
 *   bibles/ylt.json
 *   bibles/darby.json
 *   bibles/index.json     small index listing available translations
 *
 * USAGE:
 *   node download-bibles.js
 *
 *   Safe to re-run — already-downloaded files are skipped.
 *   Estimated time: 10–20 minutes depending on connection speed.
 *   Total download size: ~25–30 MB (JSON, before any compression).
 *
 * AFTER DOWNLOADING:
 *   Copy the bibles/ folder into your running ScribeFlow container:
 *
 *     docker cp bibles/ scribeflow:/app/data/bibles/
 *
 *   Or for LXC, copy to the data directory:
 *
 *     cp -r bibles/ /opt/scribeflow/backend/data/bibles/
 *
 *   Then restart ScribeFlow — the server will detect the files on startup
 *   and report how many translations are available.
 *
 * REQUIREMENTS:
 *   Node.js 14 or higher (no npm packages required — uses only built-ins)
 * ═══════════════════════════════════════════════════════════════════════
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const OUT_DIR = path.join(__dirname, 'bibles');
const CDN     = 'https://cdn.jsdelivr.net/gh/wldeh/bible-api@main/bibles';

// ── TRANSLATIONS ─────────────────────────────────────────────────────────
const TRANSLATIONS = [
  { id: 'en-kjv',   label: 'KJV',   name: 'King James Version' },
  { id: 'en-asv',   label: 'ASV',   name: 'American Standard Version' },
  { id: 'en-web',   label: 'WEB',   name: 'World English Bible' },
  { id: 'en-bbe',   label: 'BBE',   name: 'Bible in Basic English' },
  { id: 'en-ylt',   label: 'YLT',   name: "Young's Literal Translation" },
  { id: 'en-darby', label: 'Darby', name: 'Darby Translation' },
];

// ── 66 CANONICAL BOOKS (Protestant) ─────────────────────────────────────
const BOOKS = [
  // Old Testament
  'genesis','exodus','leviticus','numbers','deuteronomy',
  'joshua','judges','ruth','1-samuel','2-samuel',
  '1-kings','2-kings','1-chronicles','2-chronicles',
  'ezra','nehemiah','esther','job','psalms','proverbs',
  'ecclesiastes','song-of-solomon','isaiah','jeremiah',
  'lamentations','ezekiel','daniel','hosea','joel','amos',
  'obadiah','jonah','micah','nahum','habakkuk','zephaniah',
  'haggai','zechariah','malachi',
  // New Testament
  'matthew','mark','luke','john','acts',
  'romans','1-corinthians','2-corinthians','galatians',
  'ephesians','philippians','colossians',
  '1-thessalonians','2-thessalonians',
  '1-timothy','2-timothy','titus','philemon',
  'hebrews','james','1-peter','2-peter',
  '1-john','2-john','3-john','jude','revelation',
];

// Display names used in the UI
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

// Chapter counts per book
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

// Total chapters across all 66 books = 1,189
const TOTAL_CHAPTERS = Object.values(CHAPTER_COUNTS).reduce((a, b) => a + b, 0);

// CDN slug probing — tries multiple slug variants until one returns HTTP 200.
// Caches the working format per book so only one probe per book is needed.
const ORDINALS = ['first','second','third'];
function slugVariants(slug) {
  const variants = [slug];
  const dm = slug.match(/^([0-9]+)-(.+)$/);
  if (dm) {
    variants.push(dm[1] + dm[2]);
    const ord = ORDINALS[parseInt(dm[1]) - 1];
    if (ord) { variants.push(ord + '-' + dm[2]); variants.push(ord + dm[2]); }
  }
  if (slug.includes('-')) variants.push(slug.replace(/-/g, ''));
  return variants.filter((v, i, a) => a.indexOf(v) === i);
}
const cdnSlugCache = {};

// ── HTTP HELPER ───────────────────────────────────────────────────────────
function get(url, attempt) {
  attempt = attempt || 1;
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(get(res.headers.location, attempt));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('JSON parse failed'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pad(n, w) {
  return String(n).padStart(w, ' ');
}

// ── PROGRESS DISPLAY ─────────────────────────────────────────────────────
function progress(done, total, label) {
  const pct   = Math.floor(done / total * 100);
  const bars  = Math.floor(pct / 2);
  const bar   = '[' + '█'.repeat(bars) + '░'.repeat(50 - bars) + ']';
  process.stdout.write('\r  ' + bar + ' ' + pad(pct, 3) + '%  ' + label.padEnd(30, ' '));
}

// ── FETCH ONE TRANSLATION ─────────────────────────────────────────────────
async function fetchTranslation(t) {
  const outFile = path.join(OUT_DIR, t.label.toLowerCase() + '.json');

  if (fs.existsSync(outFile)) {
    const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    console.log('  [SKIP]    ' + t.label.padEnd(6) + ' already present (' + mb + ' MB)');
    return;
  }

  console.log('\n  [START]   ' + t.label + ' — ' + t.name);
  const startTime = Date.now();

  const bible = {
    id:    t.id,
    label: t.label,
    name:  t.name,
    books: {},
  };

  let chaptersDone = 0;

  for (const book of BOOKS) {
    const chapters = CHAPTER_COUNTS[book];
    bible.books[book] = { name: BOOK_NAMES[book], chapters: {} };

    for (let ch = 1; ch <= chapters; ch++) {
      let retries = 5;
      let backoff = 600;

      while (retries > 0) {
        try {
          // Resolve CDN slug on first use of this book
        const cacheKey = t.id + ':' + book;
        if (!cdnSlugCache[cacheKey]) {
          const candidates = slugVariants(book);
          let resolved = null;
          for (const candidate of candidates) {
            try { await get(CDN + '/' + t.id + '/books/' + candidate + '/chapters/1.json'); resolved = candidate; break; } catch(e) {}
          }
          cdnSlugCache[cacheKey] = resolved || book;
        }
        const url  = CDN + '/' + t.id + '/books/' + cdnSlugCache[t.id + ':' + book] + '/chapters/' + ch + '.json';
          const data = await get(url);
          // Normalise to array of {verse, text}
          const verses = Array.isArray(data.verses) ? data.verses
                       : Array.isArray(data)        ? data
                       : [];
          bible.books[book].chapters[ch] = verses.map(v => ({
            verse: v.verse,
            text:  (v.text || '').trim(),
          }));
          chaptersDone++;
          progress(chaptersDone, TOTAL_CHAPTERS, BOOK_NAMES[book] + ' ' + ch);
          await sleep(20); // polite delay — ~50 req/s max
          break;
        } catch (err) {
          retries--;
          if (retries === 0) {
            console.warn('\n    [WARN]  ' + BOOK_NAMES[book] + ' ' + ch + ': ' + err.message + ' — skipping');
            bible.books[book].chapters[ch] = [];
            chaptersDone++;
          } else {
            await sleep(backoff);
            backoff = Math.min(backoff * 2, 8000);
          }
        }
      }
    }
  }

  process.stdout.write('\n');
  fs.writeFileSync(outFile, JSON.stringify(bible));
  const mb      = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('  [DONE]    ' + t.label + ' → ' + mb + ' MB in ' + elapsed + ' min');
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const line = '═'.repeat(60);
  console.log('\n' + line);
  console.log('  ScribeFlow Bible Downloader');
  console.log('  Source : github.com/wldeh/bible-api (jsDelivr CDN)');
  console.log('  Output : ' + OUT_DIR);
  console.log('  Books  : 66 · Chapters : ' + TOTAL_CHAPTERS + ' · Translations : ' + TRANSLATIONS.length);
  console.log(line);

  for (const t of TRANSLATIONS) {
    try {
      await fetchTranslation(t);
    } catch (err) {
      console.error('  [ERROR]   ' + t.label + ': ' + err.message);
    }
  }

  // Write index file
  const index = TRANSLATIONS
    .filter(t => fs.existsSync(path.join(OUT_DIR, t.label.toLowerCase() + '.json')))
    .map(t => ({ id: t.label.toLowerCase(), label: t.label, name: t.name }));

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log('\n' + line);
  console.log('  Complete. ' + index.length + '/' + TRANSLATIONS.length + ' translations downloaded.');
  console.log('');
  console.log('  To install into a running Docker container:');
  console.log('    docker cp bibles/ scribeflow:/app/data/bibles/');
  console.log('');
  console.log('  To install on LXC:');
  console.log('    cp -r bibles/ /opt/scribeflow/backend/data/bibles/');
  console.log('');
  console.log('  Then restart ScribeFlow to pick up the new data.');
  console.log(line + '\n');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
