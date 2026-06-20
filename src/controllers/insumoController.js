/**
 * insumoController.js
 * Controlador completo del módulo de Inventario.
 *
 * CAMBIO PRINCIPAL: los endpoints de tipo de muestra
 * siguen existiendo pero ahora se usan desde el formulario
 * de insumo (no desde la receta). La query de recetas ya
 * no incluye tipos_muestra en su resultado.
 */

const insumoModule  = require('../modules/insumoModule');
const pool          = require('../config/db');
const { getConfig } = require('./configuracionController');
const { registrarAuditoria } = require('../helpers/auditoria');
const insumoController = {

  // ════════════════════════════════════════════════════════
  // CATEGORÍAS
  // ════════════════════════════════════════════════════════

  getCategorias: async (req, res) => {
    try { res.json(await insumoModule.listarCategorias()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  crearCategoria: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio" });
    try { res.status(201).json(await insumoModule.crearCategoria(req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  actualizarCategoria: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio" });
    try { res.json(await insumoModule.actualizarCategoria(req.params.id, req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarCategoria: async (req, res) => {
    try { res.json(await insumoModule.eliminarCategoria(req.params.id, req.user.id)); }
    catch (e) {
      const status = e.message.includes("No se puede eliminar") ? 409 : 500;
      res.status(status).json({ error: e.message });
    }
  },

  // ════════════════════════════════════════════════════════
  // INSUMOS — CRUD
  // ════════════════════════════════════════════════════════

  getInsumos: async (req, res) => {
    try { res.json(await insumoModule.listarInsumos()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  postInsumo: async (req, res) => {
    try { res.status(201).json(await insumoModule.crearInsumo(req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  putInsumo: async (req, res) => {
    try { res.json(await insumoModule.actualizarInsumo(req.params.id, req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  deleteInsumo: async (req, res) => {
    try { res.json(await insumoModule.eliminarInsumo(req.params.id, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // HISTORIAL DE MOVIMIENTOS
  // ════════════════════════════════════════════════════════

  getMovimientos: async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          m.id_movimiento,
          m.tipo_movimiento,
          m.cantidad,
          m.observacion,
          m.fecha,
          i.nombre                              AS insumo,
          i.unidad_medida,
          u.nombres || ' ' || u.apellidos       AS usuario_nombre,
          u.username
        FROM movimientos m
        JOIN insumos  i ON m.id_insumo  = i.id_insumo
        JOIN usuario  u ON m.id_usuario = u.id_usuario
        ORDER BY m.fecha DESC
        LIMIT 300
      `);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // ALERTAS
  // ════════════════════════════════════════════════════════

  listarAlertas: async (req, res) => {
    try { res.json(await insumoModule.getAlertasReabastecimiento()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // RECETAS (Examen ↔ Insumo)
  // Ya NO incluye tipos_muestra en la respuesta.
  // El tipo de muestra se ve en la tabla de Insumos.
  // ════════════════════════════════════════════════════════

  getRecetas: async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          ei.id_examen_insumo,
          ei.id_examen,
          ei.id_insumo,
          ei.cantidad_usada,
          e.nombre_examen,
          i.nombre          AS nombre_insumo,
          i.unidad_medida,
          tm.nombre         AS tipo_muestra_nombre
        FROM examen_insumo ei
        JOIN examen       e  ON ei.id_examen = e.id_examen
        JOIN insumos      i  ON ei.id_insumo = i.id_insumo
        LEFT JOIN tipo_muestra tm ON i.id_tipo_muestra = tm.id_tipo_muestra
        ORDER BY e.nombre_examen ASC, i.nombre ASC
      `);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // TIPOS DE MUESTRA
  // Siguen siendo un catálogo global que se usa en el
  // formulario de Insumo (no en Recetas).
  // ════════════════════════════════════════════════════════

  getTiposMuestra: async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id_tipo_muestra, nombre FROM tipo_muestra ORDER BY nombre ASC`
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  crearTipoMuestra: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre del tipo de muestra es obligatorio" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO tipo_muestra (nombre) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING *`,
        [nombre.trim()]
      );
      if (rows.length === 0)
        return res.status(409).json({ error: "Ya existe un tipo con ese nombre" });
      await registrarAuditoria(
        pool,           // ← o client si estás dentro de un BEGIN/COMMIT
        req.user.id,
        req.user.id_usuario_rol,
        'SE CREO_TIPO_MUESTRA',
        `Tipo de muestra creado: "${nombre.trim()}"`
      );
      res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarTipoMuestra: async (req, res) => {
    try {
      // No eliminar si está en uso por algún insumo activo
      const { rowCount: enUsoInsumo } = await pool.query(
        `SELECT 1 FROM insumos WHERE id_tipo_muestra = $1 AND estado = TRUE LIMIT 1`,
        [req.params.id]
      );
      if (enUsoInsumo > 0)
        return res.status(409).json({ error: "No se puede eliminar: hay insumos activos con este tipo" });

      await pool.query(`DELETE FROM tipo_muestra WHERE id_tipo_muestra = $1`, [req.params.id]);

      await registrarAuditoria(
        pool,
        req.user.id,
        req.user.id_usuario_rol,
        'SE ELIMINÓ_TIPO_MUESTRA',
        `Tipo de muestra eliminado ID: ${req.params.id}`
      );

      res.json({ msg: "Tipo de muestra eliminado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // ASIGNAR / QUITAR TIPO DE MUESTRA A EXAMEN (pivote)
  // Estos endpoints siguen disponibles para uso manual/futuro.
  // ════════════════════════════════════════════════════════

  asignarTipoExamen: async (req, res) => {
    const { id_examen, id_tipo_muestra } = req.body;
    if (!id_examen || !id_tipo_muestra)
      return res.status(400).json({ error: "id_examen e id_tipo_muestra son obligatorios" });
    try {
      await pool.query(
        `INSERT INTO examen_tipo_muestra (id_examen, id_tipo_muestra)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id_examen, id_tipo_muestra]
      );
      await registrarAuditoria(
        pool,           // ← o client si estás dentro de un BEGIN/COMMIT
        req.user.id,
        req.user.id_usuario_rol,
        'SE ASIGNÓ_TIPO_MUESTRA',
        ` Se asignó el tipo de muestra ID ${id_tipo_muestra} al examen ID ${id_examen}`
      );
      res.json({ msg: "Tipo de muestra asignado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  quitarTipoExamen: async (req, res) => {
    const { id_examen, id_tipo } = req.params;
    try {
      await pool.query(
        `DELETE FROM examen_tipo_muestra WHERE id_examen = $1 AND id_tipo_muestra = $2`,
        [id_examen, id_tipo]
      );
      res.json({ msg: "Tipo de muestra quitado" });
      await registrarAuditoria(
        pool,           // ← o client si estás dentro de un BEGIN/COMMIT
        req.user.id,
        req.user.id_usuario_rol,
        'SE ELIMINÓ_TIPO_MUESTRA',
        `Tipo de muestra Examen eliminado: examen ID ${id_examen}, tipo ID ${id_tipo}`
      );
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  vincularExamen: async (req, res) => {
    const { id_examen, id_insumo, cantidad_usada } = req.body;
    if (!id_examen || !id_insumo || !cantidad_usada)
      return res.status(400).json({ error: "id_examen, id_insumo y cantidad_usada son obligatorios" });

    try {
      const receta = await insumoModule.configurarReceta(id_examen, id_insumo, cantidad_usada, req.user.id);
      await registrarAuditoria(
        pool,
        req.user.id,
        req.user.id_usuario_rol,
        'SE VINCULÓ_EXAMEN',
        `Examen ID ${id_examen} vinculado con insumo ID ${id_insumo}, cantidad: ${cantidad_usada}`
      );
      res.json(receta);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarReceta: async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM examen_insumo WHERE id_examen_insumo = $1', [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Vinculación no encontrada" });
      await registrarAuditoria(
        pool,           // ← o client si estás dentro de un BEGIN/COMMIT
        req.user.id,
        req.user.id_usuario_rol,
        'SE ELIMINÓ_VINCULACIÓN',
        `Vinculación eliminada: Examen ID ${req.params.id_examen}, Insumo ID ${req.params.id_insumo}`
      );
      res.json({ msg: "Vinculación eliminada correctamente" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // MOVIMIENTO MANUAL DE STOCK
  // ════════════════════════════════════════════════════════

  registrarMovimiento: async (req, res) => {
    try {
      const resultado = await insumoModule.ajusteStockManual(req.body, req.user.id);

      const cfg = await getConfig();
      if (cfg.notificarAlertasStock && req.body.id_insumo) {
        const { rows } = await pool.query(
          'SELECT nombre, stock_actual, stock_minimo, unidad_medida FROM insumos WHERE id_insumo = $1',
          [req.body.id_insumo]
        );
        const ins = rows[0];
        if (ins && ins.stock_actual <= ins.stock_minimo) {
          const admins = await pool.query(
            `SELECT u.id_usuario FROM usuario u
             JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
             JOIN rol r ON ur.id_rol = r.id_rol
             WHERE LOWER(r.nombre) = 'administrador'
               AND u.estado = TRUE
               AND ur.activo = TRUE`
          );
          for (const adm of admins.rows) {
            await pool.query(
              `INSERT INTO notificacion (id_usuario, mensaje) VALUES ($1, $2)`,
              [adm.id_usuario,
               `⚠️ Stock bajo: "${ins.nombre}" — quedan ${ins.stock_actual} ${ins.unidad_medida} (mínimo: ${ins.stock_minimo})`]
            );
          }
          const yaExiste = await pool.query(
            `SELECT 1 FROM reabastecimiento WHERE id_insumo = $1 AND estado = 'PENDIENTE' LIMIT 1`,
            [req.body.id_insumo]
          );
          if (yaExiste.rowCount === 0) {
            await pool.query(
              `INSERT INTO reabastecimiento (id_insumo, cantidad_reportada, estado)
               VALUES ($1, $2, 'PENDIENTE')`,
              [req.body.id_insumo, ins.stock_minimo - ins.stock_actual]
            );
          }
        }
      }

      await registrarAuditoria(
        pool,
        req.user.id,
        req.user.id_usuario_rol || null,
        'SE REGISTRÓ_MOVIMIENTO',
        `Movimiento manual registrado para insumo ID: ${req.body.id_insumo}, tipo: ${req.body.tipo_movimiento}`
      );

      res.json(resultado);
    } catch (e) {
      res.status(e.message.includes("insuficiente") ? 400 : 500).json({ error: e.message });
    }
  },
};

module.exports = insumoController;