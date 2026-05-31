import os
import pytest


def pytest_addoption(parser):
    parser.addoption("--live", action="store_true", default=False, help="run live LLM/API tests")


def pytest_collection_modifyitems(config, items):
    skip_live = config.getoption("--live", default=False)
    env_skip = os.getenv("SKIP_LIVE_TESTS", "").strip() == "1"

    if not skip_live or env_skip:
        reason = "SKIP_LIVE_TESTS=1" if env_skip else "pass --live to run live LLM tests"
        marker = pytest.mark.skip(reason=reason)
        for item in items:
            if item.get_closest_marker("live"):
                item.add_marker(marker)
