"""Prioritize common Simplified Chinese and actual UI text in small font chunks.
Run after prepare-ui-font.py, with fonttools + brotli installed.
"""
from pathlib import Path
from tempfile import gettempdir
from fontTools import subset
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parents[1]
folder=root/'public/assets/fonts'
source=Path(gettempdir())/'assistant-serif.font'
chars=set(''.join(p.read_text() for p in (root/'src').glob('*.tsx')))
for high in range(0xb0,0xd8):
    for low in range(0xa1,0xff):
        try: chars.add(bytes([high,low]).decode('gb2312'))
        except UnicodeDecodeError: pass
cmap=TTFont(source).getBestCmap()
codepoints=sorted(ord(c) for c in chars if ord(c) in cmap)
css=(folder/'assistant-serif.css').read_text().split('/* Common-first')[0]
css+='/* Common-first UI and GB2312 level-one glyphs, overriding broad ranges. */\n'
for index,start in enumerate(range(0,len(codepoints),1024)):
    points=codepoints[start:start+1024]
    options=subset.Options(); options.flavor='woff2'
    font=subset.load_font(str(source),options)
    worker=subset.Subsetter(options);worker.populate(unicodes=points);worker.subset(font)
    for record in font['name'].names:
        if record.nameID in (1,3,4,6,16): record.string='AssistantSerif'.encode(record.getEncoding())
    c=font['CFF '].cff;c.fontNames=['AssistantSerif'];c.topDictIndex[0].FamilyName='AssistantSerif';c.topDictIndex[0].FullName='AssistantSerif Regular'
    filename=f'serif-common-{index}.woff2'
    subset.save_font(font,str(folder/filename),options)
    ranges=','.join(f'U+{p:X}' for p in points)
    css+='@font-face{font-family:AssistantSerif;font-style:normal;font-weight:400;font-display:swap;src:url("./'+filename+'") format("woff2");unicode-range:'+ranges+';}\n'
    print(filename,(folder/filename).stat().st_size,flush=True)
(folder/'assistant-serif.css').write_text(css)
print('Common-first glyphs',len(codepoints))
