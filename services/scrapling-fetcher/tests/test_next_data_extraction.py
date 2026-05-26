"""extract_next_data() unit tests."""

from __future__ import annotations

from app.fetcher_pool import extract_next_data


_HTML_WITH_NEXT_DATA = '''<!doctype html>
<html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"event":{"name":"Test"}}}}</script>
</body></html>'''


_HTML_WITHOUT_NEXT_DATA = '''<!doctype html>
<html><head></head><body><h1>plain page</h1></body></html>'''


_HTML_WITH_INVALID_JSON = '''<!doctype html>
<html><body>
<script id="__NEXT_DATA__" type="application/json">{"truncated":</script>
</body></html>'''


def test_extracts_well_formed_next_data():
    parsed = extract_next_data(_HTML_WITH_NEXT_DATA)
    assert parsed is not None
    assert parsed["props"]["pageProps"]["event"]["name"] == "Test"


def test_returns_none_when_script_missing():
    assert extract_next_data(_HTML_WITHOUT_NEXT_DATA) is None


def test_returns_none_on_malformed_json():
    assert extract_next_data(_HTML_WITH_INVALID_JSON) is None


def test_handles_unicode_in_payload():
    html = (
        '<script id="__NEXT_DATA__" type="application/json">'
        '{"name":"caf\\u00e9 \\u4e2d\\u6587"}</script>'
    )
    parsed = extract_next_data(html)
    assert parsed["name"] == "café 中文"
