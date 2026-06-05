const parametroModule = require('../modules/parametroModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const parametroController = {

    crear: async (req, res) => {
        try {
            const nuevo = await parametroModule.create(req.body);

            // Auditoría — usa pool (sin transacción)
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'CREAR_PARAMETRO',
                `Creó parámetro: ${nuevo.nombre_parametro} (${nuevo.sexo_referencia}) para examen ID: ${req.body.id_examen}`
            );

            res.status(201).json(nuevo);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    listarPorExamen: async (req, res) => {
        try {
            const { buscar } = req.query;
            const { id_examen } = req.params;
            const parametros = buscar
                ? await parametroModule.searchByNameInExamen(id_examen, buscar)
                : await parametroModule.getByExamen(id_examen);
            res.json(parametros);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    listarTodos: async (req, res) => {
        try {
            const parametros = await parametroModule.getAllGlobal();
            res.json(parametros);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    actualizar: async (req, res) => {
        try {
            const actualizado = await parametroModule.update(req.params.id, req.body);
            if (!actualizado) return res.status(404).json({ msg: "Parámetro no encontrado" });

            // Auditoría — usa pool (sin transacción)
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'UPDATE_PARAMETRO',
                `Actualizó rangos/sexo del parámetro ID: ${req.params.id}`
            );

            res.json(actualizado);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    listarInactivosPorExamen: async (req, res) => {
        try {
            const parametros = await parametroModule.getInactiveByExamen(req.params.id_examen);
            res.json(parametros);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    desactivar: async (req, res) => {
        try {
            const exito = await parametroModule.logicalDelete(req.params.id);
            if (!exito) return res.status(404).json({ msg: "No se pudo desactivar" });
            res.json({ msg: "Parámetro enviado a la papelera" });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    reactivar: async (req, res) => {
        try {
            const reactivado = await parametroModule.reactivate(req.params.id);
            if (!reactivado) return res.status(404).json({ msg: "No se pudo reactivar" });
            res.json({ msg: "Parámetro reactivado con éxito", parametro: reactivado });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
};

module.exports = parametroController;