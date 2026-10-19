import enum
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Rol(str, enum.Enum):
    admin = "admin"  # gestiona usuarios y todo lo demás
    dh = "dh"  # Desarrollo Humano: crea, actualiza y da de baja vendedores
    analista_dh = "analista_dh"  # igual que dh en vendedores
    lector = "lector"  # solo consulta (ej. cuenta del BI)


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    rol: Mapped[Rol] = mapped_column(Enum(Rol))
    activo: Mapped[bool] = mapped_column(default=True)
    email: Mapped[str | None] = mapped_column(String(120))
    ultimo_acceso: Mapped[datetime | None] = mapped_column(DateTime)
    # La persona debe elegir su propia contraseña al ingresar (cuentas nuevas o con clave restablecida por el admin).
    debe_cambiar_clave: Mapped[bool] = mapped_column(default=False, server_default="false")
    # Los tokens emitidos antes de este momento (UTC) dejan de valer: «cerrar sesiones» del administrador.
    sesiones_desde: Mapped[datetime | None] = mapped_column(DateTime)
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Auditoria(Base):
    """Bitácora de seguridad: ingresos, bloqueos, cambios de contraseña y gestión de usuarios."""

    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), index=True
    )  # UTC
    evento: Mapped[str] = mapped_column(String(40), index=True)
    usuario: Mapped[str | None] = mapped_column(String(60), index=True)  # a quién le ocurrió
    actor: Mapped[str | None] = mapped_column(String(60))  # quién lo hizo (si es otra persona)
    detalle: Mapped[str | None] = mapped_column(String(300))
    ip: Mapped[str | None] = mapped_column(String(45))


class Regional(Base):
    __tablename__ = "regionales"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), unique=True)
    equipos: Mapped[list["EquipoDTS"]] = relationship(back_populates="regional")


class Supervisor(Base):
    __tablename__ = "supervisores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))


class EquipoDTS(Base):
    """Equipo DTS: ej. DTS El Alto, DTS La Paz, DTS 1 y DTS 2 (Santa Cruz)."""

    __tablename__ = "equipos_dts"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), unique=True)
    regional_id: Mapped[int] = mapped_column(ForeignKey("regionales.id"))
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("supervisores.id"))

    regional: Mapped[Regional] = relationship(back_populates="equipos")
    supervisor: Mapped[Supervisor | None] = relationship()


class Vendedor(Base):
    """Colaborador de ventas. Su vínculo laboral vive en `contratos` (uno por año, renovable)."""

    __tablename__ = "vendedores"
    __table_args__ = (
        CheckConstraint("fecha_baja IS NULL OR fecha_baja >= fecha_primer_ingreso", name="ck_baja_coherente"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Llave compartida con la BD del BI (asistencia).
    codigo_vendedor: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    documento: Mapped[str | None] = mapped_column(String(30), unique=True)  # carnet de identidad
    nombre: Mapped[str] = mapped_column(String(160))
    sexo: Mapped[str | None] = mapped_column(String(1))  # M | F
    fecha_nacimiento: Mapped[date | None] = mapped_column(Date)
    telefono_corporativo: Mapped[str | None] = mapped_column(String(30))
    telefono_personal: Mapped[str | None] = mapped_column(String(30))
    cargo: Mapped[str] = mapped_column(String(60), default="ASESOR COMERCIAL")
    area: Mapped[str] = mapped_column(String(60), default="VENTAS")
    equipo_id: Mapped[int] = mapped_column(ForeignKey("equipos_dts.id"), index=True)
    # Nombre de su carpeta en la unidad compartida de RH (Vendedores\<nombre>\Contratos). Se guarda para que
    # no se rompa si luego se corrige el nombre del vendedor.
    carpeta_contratos: Mapped[str | None] = mapped_column(String(200))

    # Primer ingreso a la empresa (inicio del contrato nº 1). Se mantiene sincronizado.
    fecha_primer_ingreso: Mapped[date] = mapped_column(Date)
    fecha_baja: Mapped[date | None] = mapped_column(Date)
    motivo_baja: Mapped[str | None] = mapped_column(String(255))

    creado_por: Mapped[str | None] = mapped_column(String(80))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    equipo: Mapped[EquipoDTS] = relationship()
    contratos: Mapped[list["Contrato"]] = relationship(
        back_populates="vendedor", order_by="Contrato.numero", cascade="all, delete-orphan"
    )
    historial: Mapped[list["HistorialVendedor"]] = relationship(
        back_populates="vendedor", order_by="HistorialVendedor.id"
    )

    @property
    def vigente(self) -> bool:
        return self.fecha_baja is None

    @property
    def contrato_actual(self) -> "Contrato | None":
        return self.contratos[-1] if self.contratos else None


class Contrato(Base):
    """Contrato temporal de 1 año. Un vendedor acumula uno por renovación (nº 1, 2, 3...).

    La asistencia se mide dentro del contrato vigente. Solo el primero suele llevar
    capacitación (0 a 3 días antes de empezar a vender).
    """

    __tablename__ = "contratos"
    __table_args__ = (
        UniqueConstraint("vendedor_id", "numero", name="uq_contrato_vendedor_numero"),
        CheckConstraint("fecha_fin >= fecha_inicio", name="ck_contrato_fechas"),
        CheckConstraint("dias_capacitacion BETWEEN 0 AND 3", name="ck_dias_cap"),
        CheckConstraint("numero >= 1", name="ck_contrato_numero"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vendedor_id: Mapped[int] = mapped_column(ForeignKey("vendedores.id", ondelete="CASCADE"), index=True)
    numero: Mapped[int] = mapped_column()
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    dias_capacitacion: Mapped[int] = mapped_column(default=0)
    observacion: Mapped[str | None] = mapped_column(String(255))
    creado_por: Mapped[str | None] = mapped_column(String(80))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    vendedor: Mapped[Vendedor] = relationship(back_populates="contratos")

    @property
    def fecha_inicio_ventas(self) -> date:
        """Primer día de ventas: después de la capacitación (día 1 = ingreso)."""
        return self.fecha_inicio + timedelta(days=self.dias_capacitacion)


class Feriado(Base):
    """Día no laborable. `regional_id` nulo = feriado nacional; con valor, solo esa regional."""

    __tablename__ = "feriados"
    __table_args__ = (UniqueConstraint("fecha", "regional_id", name="uq_feriado_fecha_regional"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, index=True)
    regional_id: Mapped[int | None] = mapped_column(ForeignKey("regionales.id"))
    descripcion: Mapped[str] = mapped_column(String(160))
    # manual | holidays (automático, generado con la librería `holidays`). Los automáticos se desactivan, no se editan.
    origen: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual")
    tipo: Mapped[str | None] = mapped_column(String(60))  # Nacional | Departamental
    activo: Mapped[bool] = mapped_column(default=True, server_default="true")

    regional: Mapped[Regional | None] = relationship()


class FeriadoSync(Base):
    """Bitácora de generación de feriados por año; `mensaje` guarda la versión de la librería usada."""

    __tablename__ = "feriados_sync"

    id: Mapped[int] = mapped_column(primary_key=True)
    anio: Mapped[int] = mapped_column(index=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), index=True
    )  # UTC (no la hora del servidor de BD)
    ok: Mapped[bool] = mapped_column()
    cantidad: Mapped[int] = mapped_column(default=0)  # feriados guardados
    mensaje: Mapped[str | None] = mapped_column(String(300))
    usuario: Mapped[str | None] = mapped_column(String(80))  # nulo = automática


class HistorialVendedor(Base):
    """Eventos (alta, cambio de equipo, baja...). Base para calcular rotación por periodo."""

    __tablename__ = "historial_vendedor"

    id: Mapped[int] = mapped_column(primary_key=True)
    vendedor_id: Mapped[int] = mapped_column(ForeignKey("vendedores.id"), index=True)
    evento: Mapped[str] = mapped_column(String(30))  # alta | cambio_equipo | baja | actualizacion
    fecha: Mapped[date] = mapped_column(Date)
    detalle: Mapped[str | None] = mapped_column(String(255))
    equipo_id: Mapped[int | None] = mapped_column(ForeignKey("equipos_dts.id"))
    usuario: Mapped[str | None] = mapped_column(String(80))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    vendedor: Mapped[Vendedor] = relationship(back_populates="historial")
