// Beispielbibliothek: kleine EPUBs gemeinfreier Klassiker, im Browser erzeugt – zum Ausprobieren ohne eigene Dateien.
import { rewriteZip } from './epub/zip.js';
import { escText } from './epub/xml.js';

const BOOKS = [
  { title: 'Effi Briest', author: 'Theodor Fontane', lang: 'de', date: '1895' },
  { title: 'Der Process', author: 'Franz Kafka', lang: 'de' },
  { title: 'Buddenbrooks', author: 'Thomas Mann', lang: 'de', publisher: 'S. Fischer' },
  { title: 'Die Leiden des jungen Werthers', author: '', lang: 'de' },
  { title: 'Pride and Prejudice', author: 'Jane Austen', lang: 'en', date: '1813' },
  { title: 'Frankenstein', author: 'Mary Shelley', lang: 'en' },
  { title: 'Moby-Dick', author: 'Herman Melville', lang: 'en', series: '' },
  { title: 'Der Steppenwolf', author: 'Hermann Hesse', lang: 'de' },
];

const enc = new TextEncoder();

function opf(b, i) {
  const meta = [
    `<dc:title>${escText(b.title)}</dc:title>`,
    b.author ? `<dc:creator opf:role="aut">${escText(b.author)}</dc:creator>` : '',
    `<dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}</dc:identifier>`,
    `<dc:language>${b.lang}</dc:language>`,
    b.date ? `<dc:date>${b.date}</dc:date>` : '',
    b.publisher ? `<dc:publisher>${escText(b.publisher)}</dc:publisher>` : '',
  ].filter(Boolean).map((l) => `    ${l}`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${meta}
  </metadata>
  <manifest>
    <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="text"/>
  </spine>
</package>
`;
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

export async function demoListing() {
  const empty = { entries: [], byName: new Map(), comment: new Uint8Array(0) };
  const entries = [];
  for (const [i, b] of BOOKS.entries()) {
    const files = new Map([
      ['mimetype', enc.encode('application/epub+zip')],
      ['META-INF/container.xml', enc.encode(CONTAINER)],
      ['OEBPS/content.opf', enc.encode(opf(b, i))],
      ['OEBPS/text.xhtml', enc.encode(`<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escText(b.title)}</title></head><body><h1>${escText(b.title)}</h1><p>Beispieltext.</p></body></html>\n`)],
    ]);
    const bytes = await rewriteZip(new Uint8Array(0), empty, files);
    const name = `${b.author ? `${b.author} - ` : ''}${b.title}.epub`;
    entries.push({ path: name, name, dir: '', file: new File([bytes], name, { type: 'application/epub+zip', lastModified: Date.now() - i * 86400000 }) });
  }
  return { source: { mode: 'copy', name: 'Beispielbibliothek', root: null, canWrite: false, demo: true }, entries };
}
