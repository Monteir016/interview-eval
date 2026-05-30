from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    chroma_persist_path: str = "./chroma_db"
    sqlite_path: str = "./prepwise.db"
    full_context_path: str = "./FULL_CONTEXT.md"
    rag_top_k: int = 5

    model_config = {"env_file": ".env"}


settings = Settings()
