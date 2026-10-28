import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { EpubParseError, parseEpub } from "./epub";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-1234</dc:identifier>
    <dc:title>雪国 &amp; 温泉旅馆</dc:title>
    <dc:creator opf:role="aut" xmlns:opf="http://www.idpf.org/2007/opf">川端 康成</dc:creator>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="cov" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;

function buildEpub(opf = OPF_XML, cover?: Uint8Array) {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(CONTAINER_XML),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/text/chapter1.xhtml": strToU8("<html><body><p>hi</p></body></html>"),
  };
  if (cover) files["OEBPS/images/cover.jpg"] = cover;
  return zipSync(files);
}

describe("parseEpub", () => {
  it("解析标题、作者、标识与封面", () => {
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const meta = parseEpub(buildEpub(OPF_XML, cover));

    expect(meta.title).toBe("雪国 & 温泉旅馆");
    expect(meta.author).toBe("川端 康成");
    expect(meta.identifier).toBe("urn:uuid:test-1234");
    expect(meta.language).toBe("ja");
    expect(meta.opfPath).toBe("OEBPS/content.opf");
    expect(meta.coverExtension).toBe("jpg");
    expect(Array.from(meta.coverBytes ?? [])).toEqual(Array.from(cover));
  });

  it("只有 <meta name=cover> 时也能找到封面", () => {
    const opf = OPF_XML.replace(' properties="cover-image"', "").replace(
      "</metadata>",
      '<meta name="cover" content="cov"/></metadata>',
    );
    const meta = parseEpub(buildEpub(opf, new Uint8Array([1, 2, 3])));
    expect(meta.coverBytes?.byteLength).toBe(3);
  });

  it("没有封面时返回 undefined 而不报错", () => {
    const opf = OPF_XML.replace(' properties="cover-image"', "");
    const meta = parseEpub(buildEpub(opf));
    expect(meta.coverBytes).toBeUndefined();
    expect(meta.title).toBe("雪国 & 温泉旅馆");
  });

  it("非 ZIP 输入抛 EpubParseError", () => {
    expect(() => parseEpub(strToU8("not an epub"))).toThrow(EpubParseError);
  });

  it("缺少 container.xml 抛 EpubParseError", () => {
    const bytes = zipSync({ "OEBPS/content.opf": strToU8(OPF_XML) });
    expect(() => parseEpub(bytes)).toThrow(/container\.xml/);
  });
});
