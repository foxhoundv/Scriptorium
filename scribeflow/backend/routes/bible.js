/**
 * ScribeFlow — Bible API Route
 * Serves locally stored public-domain Bible data.
 * All data lives in backend/data/bibles/ and is fetched at build time.
 *
 * Endpoints:
 *   GET /api/bible/translations          — list available translations
 *   GET /api/bible/books                 — list all 66 books
 *   GET /api/bible/:trans/:book/:chapter — get a full chapter
 *   GET /api/bible/search?q=&trans=      — search by reference string
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const BIBLES_DIR = path.join(__dirname, '..', 'data', 'bibles');

// In-memory cache so we don't re-read JSON on every request
const cache = {};

// Book name → slug lookup (for reference parsing)
const BOOK_SLUGS = {
  // Full names
  'genesis':'genesis','exodus':'exodus','leviticus':'leviticus','numbers':'numbers',
  'deuteronomy':'deuteronomy','joshua':'joshua','judges':'judges','ruth':'ruth',
  '1samuel':'1-samuel','2samuel':'2-samuel','1kings':'1-kings','2kings':'2-kings',
  '1chronicles':'1-chronicles','2chronicles':'2-chronicles','ezra':'ezra',
  'nehemiah':'nehemiah','esther':'esther','job':'job','psalms':'psalms',
  'psalm':'psalms','proverbs':'proverbs','ecclesiastes':'ecclesiastes',
  'songofsolomon':'song-of-solomon','songs':'song-of-solomon','song':'song-of-solomon',
  'isaiah':'isaiah','jeremiah':'jeremiah','lamentations':'lamentations',
  'ezekiel':'ezekiel','daniel':'daniel','hosea':'hosea','joel':'joel','amos':'amos',
  'obadiah':'obadiah','jonah':'jonah','micah':'micah','nahum':'nahum',
  'habakkuk':'habakkuk','zephaniah':'zephaniah','haggai':'haggai',
  'zechariah':'zechariah','malachi':'malachi',
  'matthew':'matthew','mark':'mark','luke':'luke','john':'john','acts':'acts',
  'romans':'romans','1corinthians':'1-corinthians','2corinthians':'2-corinthians',
  'galatians':'galatians','ephesians':'ephesians','philippians':'philippians',
  'colossians':'colossians','1thessalonians':'1-thessalonians',
  '2thessalonians':'2-thessalonians','1timothy':'1-timothy','2timothy':'2-timothy',
  'titus':'titus','philemon':'philemon','hebrews':'hebrews','james':'james',
  '1peter':'1-peter','2peter':'2-peter','1john':'1-john','2john':'2-john',
  '3john':'3-john','jude':'jude','revelation':'revelation',
  // Abbreviations
  'gen':'genesis','ex':'exodus','exo':'exodus','lev':'leviticus','num':'numbers',
  'deut':'deuteronomy','josh':'joshua','judg':'judges','1sa':'1-samuel','2sa':'2-samuel',
  '1ki':'1-kings','2ki':'2-kings','1ch':'1-chronicles','2ch':'2-chronicles',
  'neh':'nehemiah','est':'esther','ps':'psalms','prov':'proverbs','ecc':'ecclesiastes',
  'eccl':'ecclesiastes','sos':'song-of-solomon','isa':'isaiah','jer':'jeremiah',
  'lam':'lamentations','ezek':'ezekiel','dan':'daniel','hos':'hosea',
  'mic':'micah','nah':'nahum','hab':'habakkuk','zeph':'zephaniah','hag':'haggai',
  'zech':'zechariah','mal':'malachi','matt':'matthew','mat':'matthew',
  'mk':'mark','lk':'luke','jn':'john','joh':'john','ac':'acts','act':'acts',
  'rom':'romans','1cor':'1-corinthians','2cor':'2-corinthians','gal':'galatians',
  'eph':'ephesians','phil':'philippians','col':'colossians','1thes':'1-thessalonians',
  '2thes':'2-thessalonians','1tim':'1-timothy','2tim':'2-timothy','tit':'titus',
  'phm':'philemon','heb':'hebrews','jas':'james','1pet':'1-peter','2pet':'2-peter',
  '1jn':'1-john','2jn':'2-john','3jn':'3-john','jud':'jude','rev':'revelation',
  'apoc':'revelation',
};

const BOOK_DISPLAY = {
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

function loadTranslation(trans) {
  if (cache[trans]) return cache[trans];
  const file = path.join(BIBLES_DIR, `${trans}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    cache[trans] = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cache[trans];
  } catch { return null; }
}

/**
 * Parse a human reference string into { book, chapter, verseStart, verseEnd }
 * Examples: "John 3:16", "Romans 8:1-8", "Psalm 23", "Genesis 1"
 */
function parseReference(ref) {
  if (!ref) return null;
  const s = ref.trim();

  // Match: (optional number)(word+)(optional spaces)(chapter)(optional :verse(-verse))
  const m = s.match(/^(\d?\s*[a-z\s]+?)\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/i);
  if (!m) return null;

  const rawBook = m[1].trim().toLowerCase().replace(/\s+/g, '');
  const chapter = parseInt(m[2]);
  const verseStart = m[3] ? parseInt(m[3]) : null;
  const verseEnd   = m[4] ? parseInt(m[4]) : verseStart;

  const slug = BOOK_SLUGS[rawBook];
  if (!slug || !chapter) return null;

  return { book: slug, chapter, verseStart, verseEnd,
           display: BOOK_DISPLAY[slug] || slug };
}

// ── ROUTES ──────────────────────────────────────────────────────────────

// GET /api/bible/translations
router.get('/translations', (req, res) => {
  const indexFile = path.join(BIBLES_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) {
    return res.json([]);
  }
  try {
    res.json(JSON.parse(fs.readFileSync(indexFile, 'utf8')));
  } catch {
    res.json([]);
  }
});

// GET /api/bible/books
router.get('/books', (req, res) => {
  res.json(Object.entries(BOOK_DISPLAY).map(([slug, name]) => ({ slug, name })));
});

// GET /api/bible/search?q=John+3:16&trans=kjv
router.get('/search', (req, res) => {
  const q     = (req.query.q || '').trim();
  const trans = (req.query.trans || 'kjv').toLowerCase();

  if (!q) return res.status(400).json({ error: 'Missing q parameter' });

  const parsed = parseReference(q);
  if (!parsed) return res.status(400).json({ error: `Could not parse reference: "${q}"` });

  const bible = loadTranslation(trans);
  if (!bible) {
    return res.status(404).json({
      error: `Translation "${trans}" not found. Run scripts/fetch-bibles.js to download Bible data.`
    });
  }

  const bookData = bible.books[parsed.book];
  if (!bookData) return res.status(404).json({ error: `Book not found: ${parsed.book}` });

  const chapterData = bookData.chapters[parsed.chapter];
  if (!chapterData) return res.status(404).json({ error: `Chapter not found: ${parsed.chapter}` });

  let verses = chapterData;

  // Filter to verse range if specified
  if (parsed.verseStart !== null) {
    verses = chapterData.filter(v => {
      const vn = parseInt(v.verse);
      return vn >= parsed.verseStart && vn <= (parsed.verseEnd || parsed.verseStart);
    });
    if (!verses.length) {
      return res.status(404).json({ error: `Verse(s) not found` });
    }
  }

  // Build display reference
  let refStr = `${parsed.display} ${parsed.chapter}`;
  if (parsed.verseStart) {
    refStr += `:${parsed.verseStart}`;
    if (parsed.verseEnd && parsed.verseEnd !== parsed.verseStart) {
      refStr += `–${parsed.verseEnd}`;
    }
  }

  res.json({
    reference: refStr,
    translation: trans.toUpperCase(),
    book: parsed.book,
    chapter: parsed.chapter,
    verses: verses.map(v => ({ verse: v.verse, text: (v.text || '').trim() }))
  });
});

// GET /api/bible/:trans/:book/:chapter  (direct chapter fetch)
router.get('/:trans/:book/:chapter', (req, res) => {
  const trans   = req.params.trans.toLowerCase();
  const book    = req.params.book.toLowerCase();
  const chapter = parseInt(req.params.chapter);

  const bible = loadTranslation(trans);
  if (!bible) return res.status(404).json({ error: `Translation "${trans}" not available` });

  const bookData = bible.books[book];
  if (!bookData) return res.status(404).json({ error: `Book "${book}" not found` });

  const chapterData = bookData.chapters[chapter];
  if (!chapterData) return res.status(404).json({ error: `Chapter ${chapter} not found` });

  res.json({
    reference: `${BOOK_DISPLAY[book] || book} ${chapter}`,
    translation: trans.toUpperCase(),
    book,
    chapter,
    verses: chapterData.map(v => ({ verse: v.verse, text: (v.text || '').trim() }))
  });
});

module.exports = router;
module.exports.BOOK_DISPLAY = BOOK_DISPLAY;
module.exports.BOOK_SLUGS   = BOOK_SLUGS;
