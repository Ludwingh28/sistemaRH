from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

Sexo = Literal["M", "F"]


def _limpio(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _mayus(v):
    return v.strip().upper() if isinstance(v, str) else v


def _mayus_opt(v):
    return _limpio(v).upper() if isinstance(v, str) and _limpio(v) else None


# Nomenclatura de la empresa: todo texto que se escribe se guarda en MAYÚSCULAS.
Mayus = Annotated[str, AfterValidator(_mayus)]
MayusOpt = Annotated[str | None, AfterValidator(_mayus_opt)]


# ── Contratos ────────────────────────────────────────────────────────────────

class ContratoBase(BaseModel):
    numero: int | None = Field(default=None, ge=1)
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
    dias_capacitacion: int = Field(default=0, ge=0, le=3)
    observacion: MayusOpt = None

    @model_validator(mode="after")
    def _fechas(self):
        if self.fecha_inicio and self.fecha_fin and self.fecha_fin < self.fecha_inicio:
            raise ValueError("El fin del contrato no puede ser anterior a su inicio")
        return self


class ContratoCrear(ContratoBase):
    """Renovación o contrato anterior. Todo es opcional: se calcula desde el último contrato."""


class ContratoActualizar(BaseModel):
    numero: int | None = Field(default=None, ge=1)
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
    dias_capacitacion: int | None = Field(default=None, ge=0, le=3)
    observacion: MayusOpt = None


class ContratoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    numero: int
    fecha_inicio: date
    fecha_fin: date
    dias_capacitacion: int
    fecha_inicio_ventas: date
    observacion: str | None
    estado: str = ""  # vigente | por_vencer | vencido | anterior | futuro
    dias_para_vencer: int = 0


# ── Vendedores ───────────────────────────────────────────────────────────────

class VendedorCrear(BaseModel):
    codigo_vendedor: Mayus = Field(min_length=1)
    documento: MayusOpt = None
    nombre: Mayus = Field(min_length=1)
    sexo: Sexo | None = None
    fecha_nacimiento: date | None = None
    telefono_corporativo: str | None = None
    telefono_personal: str | None = None
    cargo: Mayus = "ASESOR COMERCIAL"
    area: Mayus = "VENTAS"
    equipo_id: int
    # Si no es su primer contrato, indica cuándo ingresó a la empresa por primera vez.
    fecha_primer_ingreso: date | None = None
    contrato: ContratoCrear

    @field_validator("telefono_corporativo", "telefono_personal")
    @classmethod
    def _opt(cls, v):
        return _limpio(v)

    @model_validator(mode="after")
    def _contrato(self):
        if not self.contrato.fecha_inicio:
            raise ValueError("La fecha de inicio del contrato es obligatoria")
        return self


class VendedorActualizar(BaseModel):
    codigo_vendedor: MayusOpt = None  # corregir el código (el que usa el BI para la asistencia)
    documento: MayusOpt = None
    nombre: Mayus | None = Field(default=None, min_length=1)
    sexo: Sexo | None = None
    fecha_nacimiento: date | None = None
    telefono_corporativo: str | None = None
    telefono_personal: str | None = None
    cargo: MayusOpt = None
    area: MayusOpt = None
    equipo_id: int | None = None
    fecha_primer_ingreso: date | None = None


class VendedorBaja(BaseModel):
    fecha_baja: date
    motivo_baja: MayusOpt = None


class VendedorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo_vendedor: str
    documento: str | None
    nombre: str
    sexo: str | None
    fecha_nacimiento: date | None
    telefono_corporativo: str | None
    telefono_personal: str | None
    cargo: str
    area: str
    equipo_id: int
    equipo_nombre: str = ""
    regional_id: int = 0
    regional: str = ""
    fecha_primer_ingreso: date
    fecha_baja: date | None
    motivo_baja: str | None
    vigente: bool
    estado: str = ""  # activo | nuevo | retirado
    contrato_actual: ContratoOut | None = None
    estado_contrato: str = ""  # vigente | por_vencer | vencido | retirado
    dias_para_vencer: int | None = None
    total_contratos: int = 0


class HistorialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    evento: str
    fecha: date
    detalle: str | None
    usuario: str | None
    creado_en: datetime


class VendedorDetalle(VendedorOut):
    contratos: list[ContratoOut] = []
    historial: list[HistorialOut] = []


class ResumenVendedores(BaseModel):
    vigentes: int
    nuevos: int
    por_vencer: int
    vencidos: int
    retirados: int


# ── Importación de vendedores desde Excel ────────────────────────────────────

class ImportNuevo(BaseModel):
    fila: int
    codigo: str
    nombre: str
    equipo: str
    estado: str
    ingreso: date
    baja: date | None = None


class ImportCambio(BaseModel):
    fila: int
    codigo: str
    nombre: str
    cambios: list[str]


class ImportObservacion(BaseModel):
    nivel: str  # OMITIDO | AVISO | CORREGIDO
    fila: int
    codigo: str
    nombre: str
    mensaje: str


class ImportacionOut(BaseModel):
    aplicado: bool = False
    filas_leidas: int
    nuevos: list[ImportNuevo]
    actualizados: list[ImportCambio]
    sin_cambios: int
    omitidos: int
    bajas: int
    por_equipo: dict[str, int]
    contratos_vencidos: int
    por_vencer: int
    observaciones: list[ImportObservacion]
    carpetas_creadas: int = 0
    aviso_carpetas: str | None = None
