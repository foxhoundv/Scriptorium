const express = require('express');
const router  = express.Router();
const { getProject } = require('../db');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const { htmlToText } = require('html-to-text');

function hasReadAccess(project, userId) {
  if (!userId) return true;
  if (project.ownerId === userId) return true;
  return (project.sharedWith || []).some(s => s.userId === userId);
}

// Collect documents in binder order (only those marked includeInCompile)
function collectDocuments(node, documents, result = []) {
  if (node.type === 'document') {
    const doc = documents[node.id];
    if (doc && doc.includeInCompile) result.push(doc);
  }
  if (node.children) {
    for (const child of node.children) {
      if (child.type !== 'trash') collectDocuments(child, documents, result);
    }
  }
  return result;
}

/**
 * resolveHotlinks — replaces <span class="hl-widget" ...>...</span> with
 * plain text.  Two modes:
 *   removeHotlinks = false  → replace widget with the full hot-link name
 *                             (keeps content readable, removes the span markup)
 *   removeHotlinks = true   → replace widget with its fallbackName, falling
 *                             back to the full name if fallbackName is empty
 *
 * The hl-widget spans look like:
 *   <span class="hl-widget" ... data-hl-name="Matthew Triton" ...>...</span>
 * They may contain nested <span> children we want to discard entirely.
 */
function resolveHotlinks(html, hlPages, removeHotlinks) {
  if (!html) return html;

  // Build a lookup map:  docId → { name, fallbackName }
  const hlMap = {};
  (hlPages || []).forEach(p => {
    hlMap[p.docId] = { name: p.name || '', fallbackName: p.fallbackName || '' };
  });

  // We cannot use a simple regex with lazy matching because hl-widget spans
  // contain nested child spans (hl-w-type, hl-w-name).  A lazy [\s\S]*?<\/span>
  // stops at the FIRST inner </span>, leaving residual HTML in the output.
  // Instead, walk the string and use depth-counting to find the true closing tag.
  let result = '';
  let pos    = 0;

  while (pos < html.length) {
    const spanStart = html.indexOf('<span', pos);
    if (spanStart === -1) { result += html.slice(pos); break; }

    // Read the full opening tag to check if it's an hl-widget
    const tagEnd = html.indexOf('>', spanStart);
    if (tagEnd === -1) { result += html.slice(pos); break; }
    const openTag = html.slice(spanStart, tagEnd + 1);

    if (!openTag.includes('hl-widget')) {
      // Not a widget — advance past this '<' and keep searching
      result += html.slice(pos, spanStart + 1);
      pos = spanStart + 1;
      continue;
    }

    // Append content before this widget
    result += html.slice(pos, spanStart);

    // Find the matching </span> using nesting depth
    let depth = 1;
    let cur   = tagEnd + 1;
    while (cur < html.length && depth > 0) {
      const nextOpen  = html.indexOf('<span',  cur);
      const nextClose = html.indexOf('</span>', cur);
      if (nextClose === -1) { cur = html.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cur = nextOpen + 5;   // skip past '<span'
      } else {
        depth--;
        cur = nextClose + 7;  // skip past '</span>'
      }
    }

    // Extract docId and name from the opening tag attributes
    const docIdM  = openTag.match(/data-hl-doc="([^"]*)"/i);
    const nameM   = openTag.match(/data-hl-name="([^"]*)"/i);
    const docId   = docIdM ? docIdM[1] : '';
    const rawName = nameM  ? nameM[1]  : '';
    const name    = rawName
      .replace(/&amp;/g, '&').replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    if (removeHotlinks) {
      const entry    = hlMap[docId];
      const fallback = entry?.fallbackName || entry?.name || name;
      result += fallback;
    } else {
      result += name;
    }

    pos = cur;
  }

  return result;
}

function htmlToPlainText(html) {
  return htmlToText(html || '', {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'h1', format: 'heading' },
      { selector: 'h2', format: 'heading' },
      { selector: 'h3', format: 'heading' },
      { selector: 'p', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } }
    ]
  });
}

function htmlToMarkdown(html) {
  if (!html) return '';
  let md = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u[^>]*>(.*?)<\/u>/gi, '__$1__')
    .replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<ul[^>]*>/gi, '').replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '').replace(/<\/ol>/gi, '\n')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return md;
}

function htmlToDocxParagraphs(html) {
  const paragraphs = [];
  if (!html) return paragraphs;
  const blocks = html.split(/(<h[1-6][^>]*>.*?<\/h[1-6]>|<p[^>]*>.*?<\/p>|<li[^>]*>.*?<\/li>)/gis).filter(b => b.trim());
  for (const block of blocks) {
    if (!block.trim() || !block.startsWith('<')) continue;
    let level = null;
    if (/<h1/i.test(block)) level = HeadingLevel.HEADING_1;
    else if (/<h2/i.test(block)) level = HeadingLevel.HEADING_2;
    else if (/<h3/i.test(block)) level = HeadingLevel.HEADING_3;
    const text = block.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    if (!text) continue;
    if (level) {
      paragraphs.push(new Paragraph({ text, heading: level }));
    } else {
      const runs = [];
      const parts = block.replace(/<p[^>]*>|<\/p>/gi, '').split(/(<strong>.*?<\/strong>|<em>.*?<\/em>|<b>.*?<\/b>|<i>.*?<\/i>)/gi).filter(Boolean);
      for (const part of parts) {
        const isBold   = /<strong>|<b>/i.test(part);
        const isItalic = /<em>|<i>/i.test(part);
        const clean    = part.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
        if (clean) runs.push(new TextRun({ text: clean, bold: isBold, italics: isItalic }));
      }
      if (runs.length > 0) paragraphs.push(new Paragraph({ children: runs, spacing: { after: 200 } }));
    }
  }
  return paragraphs;
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function getHlPages(project) {
  return (project.settings && project.settings.hlPages) || [];
}

function prepareContent(doc, hlPages, removeHotlinks) {
  return resolveHotlinks(doc.content, hlPages, removeHotlinks);
}

// ── ROUTES ────────────────────────────────────────────────────────────────

// Export as plain text
router.get('/:projectId/txt', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    const docs     = collectDocuments(project.binder, project.documents);
    const hlPages  = getHlPages(project);
    const remove   = req.query.removeHotlinks === '1';

    let output = `${project.title}\n${'='.repeat(project.title.length)}\n\n`;
    for (const doc of docs) {
      output += `${doc.title}\n${'-'.repeat(doc.title.length)}\n\n`;
      output += htmlToPlainText(prepareContent(doc, hlPages, remove));
      output += '\n\n\n';
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.txt"`);
    res.send(output);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as Markdown
router.get('/:projectId/md', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    const docs     = collectDocuments(project.binder, project.documents);
    const hlPages  = getHlPages(project);
    const remove   = req.query.removeHotlinks === '1';

    let output = `# ${project.title}\n\n`;
    if (project.description) output += `${project.description}\n\n`;
    output += `---\n\n`;

    for (const doc of docs) {
      output += `## ${doc.title}\n\n`;
      output += htmlToMarkdown(prepareContent(doc, hlPages, remove));
      output += '\n\n---\n\n';
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.md"`);
    res.send(output);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as DOCX
router.get('/:projectId/docx', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    const docs     = collectDocuments(project.binder, project.documents);
    const hlPages  = getHlPages(project);
    const remove   = req.query.removeHotlinks === '1';

    const allParagraphs = [
      new Paragraph({ text: project.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: '' }),
    ];

    for (const doc of docs) {
      allParagraphs.push(new Paragraph({ text: doc.title, heading: HeadingLevel.HEADING_1, pageBreakBefore: allParagraphs.length > 2 }));
      allParagraphs.push(...htmlToDocxParagraphs(prepareContent(doc, hlPages, remove)));
      allParagraphs.push(new Paragraph({ text: '' }));
    }

    const document = new Document({
      sections: [{ properties: {}, children: allParagraphs }],
      styles: { default: { document: { run: { font: 'Georgia', size: 24 } } } }
    });

    const buffer = await Packer.toBuffer(document);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as HTML
router.get('/:projectId/html', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    const docs     = collectDocuments(project.binder, project.documents);
    const hlPages  = getHlPages(project);
    const remove   = req.query.removeHotlinks === '1';

    let body = '';
    for (const doc of docs) {
      const content = prepareContent(doc, hlPages, remove);
      body += `<section class="chapter"><h1 class="chapter-title">${doc.title}</h1><div class="chapter-content">${content || ''}</div></section>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${project.title}</title>
<style>
  body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.8; max-width: 6in; margin: 0 auto; padding: 1in; color: #1a1a1a; }
  h1 { font-size: 24pt; margin-top: 0; }
  h2 { font-size: 18pt; }
  h3 { font-size: 14pt; }
  .chapter { page-break-before: always; margin-bottom: 2em; }
  .chapter:first-child { page-break-before: avoid; }
  .chapter-title { text-align: center; margin-bottom: 2em; }
  p { margin: 0 0 1em 0; text-indent: 1.5em; }
  p:first-child { text-indent: 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<div class="title-page" style="text-align:center; padding-top:3in;">
  <h1 style="font-size:36pt;">${project.title}</h1>
  ${project.description ? `<p style="font-style:italic;font-size:14pt;">${project.description}</p>` : ''}
</div>
${body}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.html"`);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as JSON backup (always as-is, no hotlink processing)
router.get('/:projectId/json', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}-backup.json"`);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
