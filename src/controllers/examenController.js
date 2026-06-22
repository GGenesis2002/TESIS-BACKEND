const examenModule = require('../modules/examenModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');
const TIPOS_VALIDOS = ['PARAMETROS', 'PDF'];

const examenController = {

    crear: async (req, res) => {
        try {
            const { tipo_resultado, nombre_examen } = req.body;

            if (tipo_resultado && !TIPOS_VALIDOS.includes(tipo_resultado)) {
                return res.status(400).json({ 
                    error: `tipo_resultado inválido. Usa: ${TIPOS_VALIDOS.join(' | ')}` 
                });
            }

            const nuevo = await examenModule.create(req.body);

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'CREAR_EXAMEN',
                `Examen creado: "${(nombre_examen || nuevo.nombre_examen || '').trim()}"`
            );

            res.status(201).json(nuevo);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

   listarActivos: async (req, res) => {
    try {
        const { buscar, id_categoria } = req.query;

        let examenes;

        if (id_categoria) {
            examenes = await examenModule.getByCategoria(id_categoria);
        } else if (buscar) {
            examenes = await examenModule.searchByName(buscar);
        } else {
            examenes = await examenModule.getAllActive();
        }

        res.json(examenes);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
},

    listarInactivos: async (req, res) => {
        try {
            const examenes = await examenModule.getAllInactive();
            res.json(examenes);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    obtenerPorId: async (req, res) => {
        try {
            const examen = await examenModule.getById(req.params.id);
            if (!examen) return res.status(404).json({ msg: "Examen no encontrado" });
            res.json(examen);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    actualizar: async (req, res) => {
        try {
            const { tipo_resultado } = req.body;

            if (tipo_resultado && !TIPOS_VALIDOS.includes(tipo_resultado)) {
                return res.status(400).json({ 
                    error: `tipo_resultado inválido. Usa: ${TIPOS_VALIDOS.join(' | ')}` 
                });
            }

            const actualizado = await examenModule.update(req.params.id, req.body);
            if (!actualizado) return res.status(404).json({ msg: "No se encontró el examen" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'ACTUALIZAR_EXAMEN',
                `Examen actualizado: "${(actualizado.nombre_examen || actualizado.nombre || '').trim()}"`
            );

            res.json(actualizado);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    desactivar: async (req, res) => {
        try {
            const examen = await examenModule.getById(req.params.id);
            if (!examen) return res.status(404).json({ msg: "No se pudo desactivar" });

            const exito = await examenModule.logicalDelete(req.params.id);
            if (!exito) return res.status(404).json({ msg: "No se pudo desactivar" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'DESACTIVAR_EXAMEN',
                `Examen desactivado: "${(examen.nombre_examen || examen.nombre || '').trim()}"`
            );

            res.json({ msg: "Examen enviado a la papelera" });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    reactivar: async (req, res) => {
        try {
            const reactivado = await examenModule.reactivate(req.params.id);
            if (!reactivado) return res.status(404).json({ msg: "No se pudo reactivar" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'REACTIVAR_EXAMEN',
                `Examen reactivado: "${(reactivado.nombre_examen || reactivado.nombre || '').trim()}"`
            );

            res.json({ msg: "Examen reactivado", examen: reactivado });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
};

module.exports = examenController;