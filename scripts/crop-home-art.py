"""Lossless rectangular slices of supplied UI art. Originals and portrait are unchanged.
Requires Pillow; run: python3 scripts/crop-home-art.py
"""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1] / 'public/assets/ui'

def save_slices(folder, name, boxes):
    original = Image.open(ROOT / folder / f'{name}.png')
    assert original.mode == 'RGBA', 'Expected supplied transparent artwork'
    for suffix, box in boxes.items():
        original.crop(box).save(ROOT / folder / f'{name}-{suffix}.png', optimize=True)

# Top and bottom ornaments keep their aspect ratio; only the straight middle extends.
save_slices('panels', 'task-primary', {
    'top': (0, 370, 1199, 590), 'middle': (0, 590, 1199, 760),
    'bottom': (0, 760, 1199, 980),
})
save_slices('dialogue', 'assistant-dialogue', {
    'top': (55, 90, 1700, 340), 'middle': (55, 340, 1700, 400),
    'bottom': (55, 400, 1700, 750),
})
save_slices('buttons', 'buttons-source', {
    'primary-default': (20, 75, 812, 335),
    'primary-pressed': (812, 110, 1295, 333),
    'primary-disabled': (1295, 110, 1765, 333),
    'secondary-default': (35, 400, 765, 602),
    'secondary-pressed': (770, 405, 1260, 602),
    'secondary-disabled': (1272, 412, 1755, 602),
})
