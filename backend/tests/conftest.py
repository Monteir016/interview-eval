import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "live: marks tests that make real LLM/API calls (skipped by default)"
    )


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--live", default=False):
        skip_live = pytest.mark.skip(reason="pass --live to run live LLM tests")
        for item in items:
            if item.get_closest_marker("live"):
                item.add_marker(skip_live)


def pytest_addoption(parser):
    parser.addoption("--live", action="store_true", default=False, help="run live LLM tests")
