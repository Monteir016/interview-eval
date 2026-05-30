VENV := .venv/bin/activate

.PHONY: backend frontend test test-v rag-index install

backend:
	cd backend && source $(VENV) && uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

test:
	cd backend && source $(VENV) && pytest -q

test-v:
	cd backend && source $(VENV) && pytest -v

rag-index:
	cd backend && source $(VENV) && python -c "from app.services.rag import RAGService; r = RAGService(); print(r.index(), 'chunks indexed')"

install:
	cd backend && python -m venv .venv && source $(VENV) && pip install -r requirements.txt
	cd frontend && npm install
