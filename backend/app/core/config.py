from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # BD propia del sistema RH
    APP_DB_HOST: str = "localhost"
    APP_DB_PORT: int = 5432
    APP_DB_NAME: str = "sistema_rh"
    APP_DB_USER: str = "postgres"
    APP_DB_PASSWORD: str = ""
    # BD del BI (solo lectura), en formato tradicional
    DB_HOST: str | None = None
    DB_PORT: int = 5432
    DB_NAME: str | None = None
    DB_USER: str | None = None
    DB_PASSWORD: str | None = None
    # Entorno: «desarrollo» o «produccion». En producción se desactiva /docs, se exige una SECRET_KEY y
    # una clave de admin seguras, y el frontend compilado se sirve desde el propio backend (un solo puerto).
    ENTORNO: str = "desarrollo"
    FRONTEND_DIST: str | None = None  # carpeta del frontend compilado (por defecto ../frontend/dist)
    # Vite puede correr en cualquier puerto local (hay varios frontends activos)
    CORS_ORIGIN_REGEX: str = r"http://(localhost|127\.0\.0\.1):\d+"
    CORS_ORIGINS: str = ""  # orígenes permitidos separados por coma (solo si el frontend va en otro dominio)
    # Contratos: carpeta compartida de RH. Estructura: <CONTRATOS_DIR>\Vendedores\<NOMBRE>\Contratos\...
    CONTRATOS_DIR: str | None = None  # raíz (p. ej. E:\Docs_RRHH o \\servidor\Docs_RRHH)
    CONTRATOS_SUBCARPETA: str = "Vendedores"
    CONTRATOS_CARPETA_FINAL: str = "Contratos"
    CONTRATOS_RUTA_RED: str | None = None  # cómo ve la carpeta RH desde sus PCs (solo para mostrarla), p. ej. \\servidor\Docs_RRHH
    CONTRATOS_MAX_MB: int = 15
    # Protección contra adivinar contraseñas
    LOGIN_MAX_INTENTOS: int = 5
    LOGIN_BLOQUEO_MIN: int = 15
    SECRET_KEY: str  # obligatoria: openssl rand -hex 32
    # Sesión: el token dura TOKEN_MINUTES y se renueva solo mientras la persona trabaja (sesión deslizante),
    # pero ninguna sesión vive más de SESION_MAX_HORAS desde que se ingresó con la contraseña.
    TOKEN_MINUTES: int = 60
    SESION_MAX_HORAS: int = 12
    PASSWORD_MIN: int = 8
    ADMIN_USERNAME: str | None = None
    ADMIN_PASSWORD: str | None = None

    @property
    def es_produccion(self) -> bool:
        return self.ENTORNO.strip().lower() in ("produccion", "producción", "production", "prod")

    @property
    def DATABASE_URL(self) -> str:
        pwd = quote_plus(self.APP_DB_PASSWORD)
        return f"postgresql+psycopg://{quote_plus(self.APP_DB_USER)}:{pwd}@{self.APP_DB_HOST}:{self.APP_DB_PORT}/{self.APP_DB_NAME}"

    @property
    def BI_DATABASE_URL(self) -> str | None:
        if not (self.DB_HOST and self.DB_NAME and self.DB_USER):
            return None
        pwd = quote_plus(self.DB_PASSWORD or "")
        return f"postgresql+psycopg://{quote_plus(self.DB_USER)}:{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"


settings = Settings()
