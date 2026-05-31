from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str
    tavily_api_key: str = ""
    chroma_persist_path: str = "./chroma_db"
    sqlite_path: str = "./prepwise.db"
    full_context_path: str = "../private/FULL_CONTEXT.md"
    private_path: str = "../private"
    rag_top_k: int = 5

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
