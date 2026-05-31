VENV := .venv/bin/activate

.PHONY: backend frontend test test-v test-live rag-index install install-hooks

backend:
	cd backend && source $(VENV) && uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

test:
	cd backend && source $(VENV) && pytest -q

test-v:
	cd backend && source $(VENV) && pytest -v

test-live:
	cd backend && source $(VENV) && pytest -q --live

rag-index:
	cd backend && source $(VENV) && python -m app.services.rag index

install:
	cd backend && python -m venv .venv && source $(VENV) && pip install -r requirements.txt
	cd frontend && npm install

install-hooks:
	sh scripts/install-hooks.sh
