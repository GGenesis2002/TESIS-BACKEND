const cajaModule = require('../modules/cajaModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');
const { generarPdfCierre } = require('../services/pdfCierreCaja');
const { enviarCorreo } = require('../services/emailService');
const { obtenerCorreosCierreCaja } = require('./configuracionController');

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

// Genera el PDF del cierre recién cerrado y lo envía a los correos
// configurados en Configuración del sistema (correosCierreCaja). Si no hay
// correos configurados, o si el envío falla, no interrumpe el cierre de
// caja: el turno ya quedó cerrado y guardado correctamente de todas formas.
const enviarReporteCierrePorCorreo = async (id_cierre) => {
    try {
        const correos = await obtenerCorreosCierreCaja();
        if (correos.length === 0) return;

        const detalle = await cajaModule.obtenerDetalleCierre(id_cierre);
        const { cierre } = detalle;
        const pdfBuffer = await generarPdfCierre(detalle);
        const pdfBase64 = pdfBuffer.toString('base64');

        const dif = parseFloat(cierre.diferencia || 0);
        const cuadrado = Math.abs(dif) < 0.01;
        const asunto = `Cierre de caja #${cierre.id_cierre} — ${cierre.nombres || ''} ${cierre.apellidos || ''}`.trim();
        const html = `
            <p>Se cerró el turno de caja <strong>#${cierre.id_cierre}</strong>, a cargo de
            ${cierre.nombres || ''} ${cierre.apellidos || ''}.</p>
            <p>
                Efectivo esperado: $${parseFloat(cierre.efectivo_esperado || 0).toFixed(2)}<br/>
                Efectivo contado: $${parseFloat(cierre.efectivo_contado || 0).toFixed(2)}<br/>
                ${cuadrado ? 'Caja cuadrada' : (dif > 0 ? `Sobrante: $${Math.abs(dif).toFixed(2)}` : `Faltante: $${Math.abs(dif).toFixed(2)}`)}
            </p>
            <p>Se adjunta el reporte completo en PDF.</p>
        `;

        const adjunto = [{ content: pdfBase64, name: `cierre_caja_${cierre.id_cierre}.pdf` }];
        await Promise.all(correos.map(correo => enviarCorreo(correo, asunto, html, adjunto)));
    } catch (err) {
        console.error(`No se pudo enviar el reporte del cierre #${id_cierre} por correo:`, err);
    }
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

            // No se espera (await) de forma bloqueante el envío de correo con
            // try/catch propio: si Brevo falla o tarda, el cierre de caja ya
            // quedó guardado y la secretaria no debe quedarse esperando.
            enviarReporteCierrePorCorreo(turno.id_cierre);

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