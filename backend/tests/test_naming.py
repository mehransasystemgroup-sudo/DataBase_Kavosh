"""ساختن نام فارسی ستون از اجزای نام — core.naming"""
from pathlib import Path

import pytest
import yaml

from core.naming import Composer

KB = Path(__file__).resolve().parents[1] / "kb"


@pytest.fixture(scope="module")
def composer():
    return Composer(yaml.safe_load((KB / "semantics" / "_vocabulary.yaml").read_text("utf-8")), {})


@pytest.mark.parametrize("name, title", [
    ("ConfirmDate", "تاریخ تأیید"),
    ("PartUnitPrice", "قیمت واحد کالا"),
    ("MaxIncreasePercent", "حداکثر درصد افزایش"),
    ("LastModificationDate", "تاریخ آخرین تغییر"),
    ("ToDate", "تا تاریخ"),
    ("CurrencyID", "شناسهٔ ارز"),
    ("ConfirmerRef", "تأییدکننده"),
    ("DLRef1", "تفصیلی 1"),
    ("DurationHours", "مدت (ساعت)"),
    ("LabourFeeActual", "نرخ دستمزد واقعی"),
    ("CanEditPrice", "امکان ویرایش قیمت"),
    ("IsEditableByUser", "قابل ویرایش توسط کاربر"),
    ("FreeQuantityByMajorUnit", "مقدار رایگان بر حسب واحد اصلی"),
    ("DisplayOrder", "ترتیب نمایش"),
    ("LetterNo", "شماره نامه"),
])
def test_compose(composer, name, title):
    assert composer.compose(name) == title


@pytest.mark.parametrize("name", ["XyzFoo", "IRPItemID", "ECEType", "To"])
def test_unknown_part_gives_no_name(composer, name):
    # یک جزء ناشناخته کافی است تا هیچ نامی ساخته نشود
    assert composer.compose(name) is None
