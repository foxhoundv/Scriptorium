#!/usr/bin/env node
/**
 * ScribeFlow — Bible Data Fetcher
 * Downloads complete public-domain Bible translations from the wldeh/bible-api
 * CDN (jsDelivr) and stores them locally in backend/data/bibles/.
 *
 * Runs at Docker image build time and on LXC first-start.
 * Safe to re-run — skips translations already present.
 *
 * Translations bundled (all public domain):
 *   KJV   — King James Version (1769)
 *   ASV   — American Standard Version (1901)
 *   WEB   — World English Bible (modern, public domain)
 *   BBE   — Bible in Basic English (1949/1964)
 *   YLT   — Young's Literal Translation (1898)
 *   Darby — Darby Translation (1890)
 */

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

// 66 canonical books (Protestant)
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

// Display names for books (used in UI)
const BOOK_NAMES = {
  'genesis':'Genesis','exodus':'Exodus','leviticus':'Leviticus','numbers':'Numbers',
  'deuteronomy':'Deuteronomy','joshua':'Joshua','judges':'Judges','ruth':'Ruth',
  '1-samuel':'1 Samuel','2-samuel':'2 Samuel','1-kings':'1 Kings','2-kings':'2 Kings',
  '1-chronicles':'1 Chronicles','2-chronicles':'2 Chronicles','ezra':'Ezra',
  'nehemiah':'Nehemiah','esther':'Esther','job':'Job','psalms':'Psalms',
  'proverbs':'Proverbs','ecclesiastes':'Ecclesiastes','song-of-solomon':'Song of Solomon',
  'isaiah':'Isaiah','jeremiah':'Jeremiah','lamentations':'Lamentations',
  'ezekiel':'Ezekiel','daniel':'Daniel','hosea':'Hosea','joel':'Joel','amos':'Amos',
  'obadiah':'Obadiah','jonah':'Jonah','micah':'Micah','nahum':'Nahum',
  'habakkuk':'Habakkuk','zephaniah':'Zephaniah','haggai':'Haggai',
  'zechariah':'Zechariah','malachi':'Malachi',
  'matthew':'Matthew','mark':'Mark','luke':'Luke','john':'John','acts':'Acts',
  'romans':'Romans','1-corinthians':'1 Corinthians','2-corinthians':'2 Corinthians',
  'galatians':'Galatians','ephesians':'Ephesians','philippians':'Philippians',
  'colossians':'Colossians','1-thessalonians':'1 Thessalonians',
  '2-thessalonians':'2 Thessalonians','1-timothy':'1 Timothy','2-timothy':'2 Timothy',
  'titus':'Titus','philemon':'Philemon','hebrews':'Hebrews','james':'James',
  '1-peter':'1 Peter','2-peter':'2 Peter','1-john':'1 John','2-john':'2 John',
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

function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch(e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTranslation(t) {
  const outFile = path.join(OUT_DIR, `${t.label.toLowerCase()}.json`);
  if (fs.existsSync(outFile)) {
    const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    console.log(`  [SKIP] ${t.label} already present (${size} MB)`);
    return true;
  }

  console.log(`  [FETCH] ${t.label} — ${t.name}`);
  const bible = { id: t.id, label: t.label, name: t.name, books: {} };

  let booksDone = 0;
  for (const book of BOOKS) {
    const chapters = CHAPTER_COUNTS[book];
    bible.books[book] = { name: BOOK_NAMES[book], chapters: {} };
    for (let ch = 1; ch <= chapters; ch++) {
      let retries = 4;
      while (retries > 0) {
        try {
          const url = `${CDN}/${t.id}/books/${book}/chapters/${ch}.json`;
          const data = await get(url);
          // Normalise: store as array of {verse, text}
          const verses = data.verses || data;
          bible.books[book].chapters[ch] = Array.isArray(verses) ? verses : [];
          await sleep(25);
          break;
        } catch (err) {
          retries--;
          if (retries === 0) {
            console.warn(`    [WARN] ${t.label} ${BOOK_NAMES[book]} ${ch}: ${err.message}`);
            bible.books[book].chapters[ch] = [];
          } else {
            await sleep(800);
          }
        }
      }
    }
    booksDone++;
    process.stdout.write(`    ${t.label}: ${booksDone}/${BOOKS.length} books (${BOOK_NAMES[book]})   \r`);
  }

  fs.writeFileSync(outFile, JSON.stringify(bible));
  const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n  [DONE] ${t.label} → ${size} MB`);
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('─'.repeat(52));
  console.log('  ScribeFlow Bible Data Fetcher');
  console.log(`  Output: ${OUT_DIR}`);
  console.log('─'.repeat(52));

  let success = 0;
  for (const t of TRANSLATIONS) {
    try {
      await fetchTranslation(t);
      success++;
    } catch (err) {
      console.error(`  [ERROR] ${t.label}: ${err.message}`);
    }
  }

  // Write index
  const index = TRANSLATIONS
    .filter(t => fs.existsSync(path.join(OUT_DIR, `${t.label.toLowerCase()}.json`)))
    .map(t => ({ id: t.label.toLowerCase(), label: t.label, name: t.name }));

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log('─'.repeat(52));
  console.log(`  Done. ${index.length} translation(s) available.`);
  console.log('─'.repeat(52));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
