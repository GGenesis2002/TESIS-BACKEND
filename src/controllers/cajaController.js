const cajaModule = require('../modules/cajaModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');

// Resuelve el id_secretaria del usuario autenticado. Lanza un error marcado
// con `esPerfil` si el usuario no tiene perfil de asistente/secretaria.
const obtenerIdSecretaria = async (id_usuario) => {
    const res = await pool.query(
        `SELECT id_secretaria FROM asistente_analista WHERE id_usuario = $1`,
        [id_usuario]
    );
    if (res.rows.length === 0) {
        const err = new Error('El usuario autenticado no tiene perfil de asistente/secretaria asignado.');
        err.esPerfil = true;
        throw err;
    }
    return res.rows[0].id_secretaria;
};

const cajaController = {

    // POST /caja/abrir
    // Body: { monto_inicial?: number }
    abrirTurno: async (req, res) => {
        try {
            const id_secretaria = await obtenerIdSecretaria(req.user.id);
            const { monto_inicial } = req.body;

            const turno = await cajaModule.abrirTurno({ id_secretaria, monto_inicial });

            await registrarAuditoria(
                pool, req.user.id, req.user.id_usuario_rol, 'ABRIR_TURNO_CAJA',
                `Turno de caja #${turno.id_cierre} abierto con fondo inicial de $${parseFloat(turno.monto_inicial).toFixed(2)}`
            );

            res.status(201).json({ msg: 'Turno de caja abierto con éxito.', turno });
        } catch (e) {
            const status = e.esPerfil
                ? 403
                : (e.message.includes('Ya tienes') || e.message.includes('negativo') ? 400 : 500);
            res.status(status).json({ error: e.message });
        }
    },

    // GET /caja/actual — turno abierto de la secretaria autenticada (o null)
    obtenerTurnoActivo: async (req, res) => {
        try {
            const id_secretaria = await obtenerIdSecretaria(req.user.id);
            const turno = await cajaModule.obtenerTurnoActivo(id_secretaria);
            res.json(turno);
        } catch (e) {
            res.status(e.esPerfil ? 403 : 500).json({ error: e.message });
        }
    },

    // POST /caja/cerrar
    // Body: { id_cierre: number, efectivo_contado: number, observaciones?: string }
    cerrarTurno: async (req, res) => {
        try {
            const id_secretaria = await obtenerIdSecretaria(req.user.id);
            const { id_cierre, efectivo_contado, observaciones } = req.body;

            if (!id_cierre) {
                return res.status(400).json({ error: 'id_cierre es obligatorio.' });
            }

            const turno = await cajaModule.cerrarTurno({
                id_cierre: parseInt(id_cierre),
                id_secretaria,
                efectivo_contado,
                observaciones,
            });

            await registrarAuditoria(
                pool, req.user.id, req.user.id_usuario_rol, 'CERRAR_TURNO_CAJA',
                `Turno de caja #${turno.id_cierre} cerrado — efectivo esperado: $${parseFloat(turno.efectivo_esperado).toFixed(2)}, contado: $${parseFloat(turno.efectivo_contado).toFixed(2)}, diferencia: $${parseFloat(turno.diferencia).toFixed(2)}`
            );

            res.json({ msg: 'Turno de caja cerrado con éxito.', turno });
        } catch (e) {
            const esNegocio =
                e.message.includes('no existe') || e.message.includes('cerrado') ||
                e.message.includes('Solo la secretaria') || e.message.includes('obligatorio') ||
                e.message.includes('indicar') || e.message.includes('negativo') || e.esPerfil;
            res.status(e.esPerfil ? 403 : (esNegocio ? 400 : 500)).json({ error: e.message });
        }
    },

    // GET /caja/cierre/:id — detalle imprimible de un cierre específico
    obtenerDetalleCierre: async (req, res) => {
        try {
            const detalle = await cajaModule.obtenerDetalleCierre(parseInt(req.params.id));
            res.json(detalle);
        } catch (e) {
            res.status(e.message.includes('no existe') ? 404 : 500).json({ error: e.message });
        }
    },

    // GET /caja/historial — historial de los cierres realizados por la secretaria autenticada
    listarCierres: async (req, res) => {
        try {
            const id_secretaria = await obtenerIdSecretaria(req.user.id);
            const lista = await cajaModule.listarCierres(id_secretaria);
            res.json(lista);
        } catch (e) {
            res.status(e.esPerfil ? 403 : 500).json({ error: e.message });
        }
    },
    // GET /caja/ultimo-cierre — último cierre de caja registrado en el sistema
    // (de cualquier secretaria), para que quien abre un turno nuevo sepa en
    // qué quedó el turno anterior antes de empezar el suyo.
    obtenerUltimoCierre: async (req, res) => {
        try {
            const ultimo = await cajaModule.obtenerUltimoCierreGlobal();
            res.json(ultimo);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },
};

module.exports = cajaController;