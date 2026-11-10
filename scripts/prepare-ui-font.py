"""Build renamed, Unicode-split Source Han Serif SC WOFF2 files.
Run with fonttools[woff] installed. Source and OFL from official Adobe repo.
"""
from pathlib import Path
from tempfile import gettempdir
import shutil
import urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
folder = root / 'public/assets/fonts'
folder.mkdir(parents=True, exist_ok=True)
source = Path(gettempdir()) / 'assistant-serif.font'
if not source.exists():
    urllib.request.urlretrieve('https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/OTF/SimplifiedChinese/SourceHanSerifSC-Regular.otf', source)
cmap = TTFont(source).getBestCmap()
groups = {}
for cp in sorted(cmap):
    groups.setdefault(cp // 2048, []).append(cp)
css = ['/* Source Han Serif SC Regular, OFL; renamed AssistantSerif subsets. */']
for group, codepoints in groups.items():
    options = subset.Options()
    options.flavor = 'woff2'
    font = subset.load_font(str(source), options)
    worker = subset.Subsetter(options)
    worker.populate(unicodes=codepoints)
    worker.subset(font)
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16):
            record.string = 'AssistantSerif'.encode(record.getEncoding())
    cff = font['CFF '].cff
    cff.fontNames = ['AssistantSerif']
    cff.topDictIndex[0].FamilyName = 'AssistantSerif'
    cff.topDictIndex[0].FullName = 'AssistantSerif Regular'
    filename = f'serif-{group:x}.woff2'
    subset.save_font(font, str(folder / filename), options)
    css.append('@font-face{font-family:AssistantSerif;font-style:normal;font-weight:400;font-display:swap;src:url("./'+filename+'") format("woff2");unicode-range:U+'+f'{group*2048:X}-{group*2048+2047:X}'+';}')
    print(filename, (folder / filename).stat().st_size, flush=True)
(folder / 'assistant-serif.css').write_text('\n'.join(css)+'\n')
shutil.copy(root / 'public/assets/font-previews/serif-OFL.txt', folder / 'OFL.txt')
print('Covered Unicode codepoints:', len(cmap), 'chunks:', len(groups))
