const categoriaModule = require('../modules/categoriaModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');

const categoriaController = {
    crear: async (req, res) => {
        try {
            const { nombre_categoria, descripcion } = req.body;
            const nueva = await categoriaModule.create(nombre_categoria, descripcion);

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE CREO_CATEGORIA',
                `Categoría creada: ${nombre_categoria}`
            );

            res.status(201).json(nueva);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },


    listarActivas: async (req, res) => {
        try {
            const categorias = await categoriaModule.getAllActive();
            res.json(categorias);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    listarActivas: async (req, res) => {
    try {
        const { buscar } = req.query; 
        let categorias;

        if (buscar) {
            categorias = await categoriaModule.searchByName(buscar);
        } else {
            categorias = await categoriaModule.getAllActive();
        }
        res.json(categorias);
    } catch (e) { res.status(500).json({ error: e.message }); }
},

listarInactivas: async (req, res) => {
        try {
            const categorias = await categoriaModule.getAllInactive();
            res.json(categorias);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    obtenerPorId: async (req, res) => {
        try {
            const categoria = await categoriaModule.getById(req.params.id);
            if (!categoria) return res.status(404).json({ msg: "Categoría no encontrada" });
            res.json(categoria);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    actualizar: async (req, res) => {
        try {
            const { nombre_categoria, descripcion } = req.body;
            const actualizada = await categoriaModule.update(req.params.id, nombre_categoria, descripcion);
            if (!actualizada) return res.status(404).json({ msg: "No se encontró" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE ACTUALIZO_CATEGORIA',
                `Categoría actualizada: ${actualizada.nombre_categoria}`
            );

            res.json(actualizada);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

   desactivar: async (req, res) => {
        // Usamos un cliente conectado para la transacción
        const client = await pool.connect(); 
        
        try {
            const { id } = req.params;
            
            await client.query('BEGIN'); // Iniciar transacción

            // 1. Apagar (Baja lógica) la categoría principal
            // ¡CORRECCIÓN AQUÍ! La tabla es categoria_examen, no categoria
            const catRes = await client.query(
                'UPDATE categoria_examen SET estado = FALSE WHERE id_categoria = $1 RETURNING nombre_categoria', 
                [id]
            );

            if (catRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ msg: "Categoría no encontrada" });
            }

            // 2. LA ACCIÓN: Apagar todos los exámenes que pertenezcan a esta categoría
            await client.query(
                'UPDATE examen SET estado = FALSE WHERE id_categoria = $1', 
                [id]
            );

            // 3. Auditoría (Opcional, pero muy recomendado)
            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'SE DESACTIVO_CATEGORIA',
                `Desactivó la categoría ${catRes.rows[0].nombre_categoria} y todos sus exámenes`
            );

            await client.query('COMMIT'); // Guardar todos los cambios
            
            res.json({ msg: "Categoría y sus exámenes asociados fueron desactivados." });
        } catch (error) {
            await client.query('ROLLBACK'); // Si algo falla, deshacer todo
            console.log("❌ ERROR EN LA BD:", error.message); // Por si acaso algo más falla, lo veremos aquí
            res.status(500).json({ error: error.message });
        } finally {
            client.release(); // Liberar la conexión
        }
    },

    reactivar: async (req, res) => {
        try {
            const reactivada = await categoriaModule.reactivate(req.params.id);
            if (!reactivada) return res.status(404).json({ msg: "No se pudo reactivar" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE REACTIVO_CATEGORIA',
                `Categoría reactivada: ${reactivada.nombre_categoria}`
            );

            res.json({ msg: "Categoría reactivada con éxito", categoria: reactivada });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
};

module.exports = categoriaController;