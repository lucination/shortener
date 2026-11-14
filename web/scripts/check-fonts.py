"""Inspect actual self-hosted font binary axes, not CSS declarations."""
import json
from fontTools.ttLib import TTFont

results = []
for path in ['static/fonts/jetbrains-mono.woff2', 'static/fonts/jetbrains-mono-italic.woff2']:
    font = TTFont(path)
    axes = [{"tag": axis.axisTag, "min": axis.minValue, "default": axis.defaultValue, "max": axis.maxValue} for axis in font['fvar'].axes]
    weight = next(axis for axis in axes if axis['tag'] == 'wght')
    assert weight['min'] == 100 and weight['max'] == 800, (path, axes)
    results.append({"file": path, "axes": axes, "italic": bool(font['head'].macStyle & 2)})
print(json.dumps(results))
