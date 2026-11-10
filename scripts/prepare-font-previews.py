"""Build preview-only WOFF2 subsets from official repositories.
Requires fonttools + brotli. Does not install final application fonts.
Copyright and OFL notices accompany the renamed preview subsets.
"""
from pathlib import Path
from tempfile import gettempdir
import urllib.request
from fontTools import subset

folder = Path(__file__).resolve().parents[1] / "public/assets/font-previews"
folder.mkdir(parents=True, exist_ok=True)
sample = (
    "总裁，今日最重要的事务已为您整理妥当。预计需要两小时，现在开始吗？"
    "律私人特助任务管理项目日程规划生活与律交谈安排事务温柔可靠优雅克制"
    "字体候选思源宋体霞鹜文楷中文标题正文按钮明天下午三点写歌"
    "1234567890：年月日星期一二四五六七 MY PRIVATE ASSISTANT"
)
fonts = [
    ("serif", "https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/OTF/SimplifiedChinese/SourceHanSerifSC-Regular.otf",
     "https://raw.githubusercontent.com/adobe-fonts/source-han-serif/master/LICENSE.txt"),
    ("wenkai", "https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf",
     "https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt"),
]
for name, url, license_url in fonts:
    original = Path(gettempdir()) / f"assistant-{name}.font"
    if not original.exists():
        urllib.request.urlretrieve(url, original)
    options = subset.Options()
    options.flavor = "woff2"
    font = subset.load_font(str(original), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=sample)
    subsetter.subset(font)
    # Only subset family/style identifiers change. Copyright/license IDs remain.
    for name_id in [1, 3, 4, 6, 16]:
        for platform, encoding, language in [(3, 1, 0x409), (1, 0, 0)]:
            font["name"].setName("AssistantPreview" + name.title(), name_id,
                                 platform, encoding, language)
    output = folder / f"{name}.woff2"
    subset.save_font(font, str(output), options)
    urllib.request.urlretrieve(license_url, folder / f"{name}-OFL.txt")
    print(name, output.stat().st_size)
