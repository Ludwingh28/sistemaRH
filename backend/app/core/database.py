from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)

# BD del BI: conexión de solo lectura, opcional hasta configurarla.
bi_engine = (
    create_engine(settings.BI_DATABASE_URL, pool_pre_ping=True)
    if settings.BI_DATABASE_URL
    else None
)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
