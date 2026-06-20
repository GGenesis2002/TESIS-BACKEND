/**
 * insumoModule.js
 * Lógica de negocio del módulo de Inventario.
 *
 * CAMBIO PRINCIPAL: el tipo de muestra ahora es una propiedad
 * del insumo (columna id_tipo_muestra en la tabla insumos),
 * no se infiere ni se asigna desde la receta.
 */

const pool = require('../config/db');

const insumoModule = {

  // ════════════════════════════════════════════════════════
  // CATEGORÍAS DE INSUMOS
  // ════════════════════════════════════════════════════════

  listarCategorias: async () => {
    const { rows } = await pool.query(
      `SELECT id_categoria_insumo, nombre, descripcion
       FROM categoria_insumo
       ORDER BY nombre ASC`
    );
    return rows;
  },

  crearCategoria: async (data, id_usuario) => {
    const { nombre, descripcion } = data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO categoria_insumo (nombre, descripcion)
         VALUES ($1, $2) RETURNING *`,
        [nombre, descripcion || null]
      );
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'CREAR_CATEGORIA_INSUMO', `Categoría creada: "${nombre}"`]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  actualizarCategoria: async (id, data, id_usuario) => {
    const { nombre, descripcion } = data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE categoria_insumo SET nombre = $1, descripcion = $2
         WHERE id_categoria_insumo = $3 RETURNING *`,
        [nombre, descripcion || null, id]
      );
      if (rows.length === 0) throw new Error("Categoría no encontrada");
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'EDITAR_CATEGORIA_INSUMO', `Categoría ID ${id} actualizada: "${nombre}"`]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  eliminarCategoria: async (id, id_usuario) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM insumos
       WHERE id_categoria_insumo = $1 AND estado = TRUE`, [id]
    );
    if (parseInt(rows[0].total) > 0) {
      throw new Error(`No se puede eliminar: tiene ${rows[0].total} insumo(s) activo(s) vinculados`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM categoria_insumo WHERE id_categoria_insumo = $1', [id]);
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'ELIMINAR_CATEGORIA_INSUMO', `Categoría ID ${id} eliminada`]
      );
      await client.query('COMMIT');
      return { msg: "Categoría eliminada correctamente" };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  // ════════════════════════════════════════════════════════
  // INSUMOS — CRUD
  // ════════════════════════════════════════════════════════

  listarInsumos: async () => {
    const { rows } = await pool.query(`
      SELECT
        i.*,
        c.nombre   AS categoria_nombre,
        tm.nombre  AS tipo_muestra_nombre
      FROM insumos i
      LEFT JOIN categoria_insumo c  ON i.id_categoria_insumo = c.id_categoria_insumo
      LEFT JOIN tipo_muestra     tm ON i.id_tipo_muestra      = tm.id_tipo_muestra
      WHERE i.estado = TRUE
      ORDER BY i.id_insumo DESC
    `);
    return rows;
  },

  crearInsumo: async (data, id_usuario) => {
    const {
      id_categoria_insumo, nombre, descripcion,
      unidad_medida, stock_actual, stock_minimo,
      id_tipo_muestra,            // ← nuevo campo
    } = data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO insumos
           (id_categoria_insumo, nombre, descripcion, unidad_medida,
            stock_actual, stock_minimo, id_tipo_muestra)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          id_categoria_insumo || null,
          nombre,
          descripcion || null,
          unidad_medida,
          stock_actual  || 0,
          stock_minimo  || 0,
          id_tipo_muestra || null,
        ]
      );
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'CREAR_INSUMO',
         `Insumo creado: "${nombre}" — stock inicial: ${stock_actual || 0}`]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  actualizarInsumo: async (id, data, id_usuario) => {
    const {
      id_categoria_insumo, nombre, descripcion,
      unidad_medida, stock_minimo,
      id_tipo_muestra,            // ← nuevo campo
    } = data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE insumos
         SET id_categoria_insumo = $1,
             nombre              = $2,
             descripcion         = $3,
             unidad_medida       = $4,
             stock_minimo        = $5,
             id_tipo_muestra     = $6
         WHERE id_insumo = $7 RETURNING *`,
        [
          id_categoria_insumo || null,
          nombre,
          descripcion || null,
          unidad_medida,
          stock_minimo,
          id_tipo_muestra || null,
          id,
        ]
      );
      if (rows.length === 0) throw new Error("Insumo no encontrado");
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'ACTUALIZAR_INSUMO', `Insumo ID ${id} actualizado`]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  eliminarInsumo: async (id, id_usuario) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE insumos SET estado = FALSE WHERE id_insumo = $1", [id]);
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'DESACTIVAR_INSUMO', `Borrado lógico del insumo ID: ${id}`]
      );
      await client.query('COMMIT');
      return { msg: "Insumo desactivado correctamente" };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  // ════════════════════════════════════════════════════════
  // RECETAS — Examen ↔ Insumo
  // El tipo de muestra YA NO se infiere aquí.
  // Se toma directo del insumo (i.id_tipo_muestra).
  // ════════════════════════════════════════════════════════

  configurarReceta: async (id_examen, id_insumo, cantidad_usada, id_usuario) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insertar o actualizar la vinculación examen ↔ insumo
      const { rows } = await client.query(
        `INSERT INTO examen_insumo (id_examen, id_insumo, cantidad_usada)
         VALUES ($1, $2, $3)
         ON CONFLICT (id_examen, id_insumo)
         DO UPDATE SET cantidad_usada = EXCLUDED.cantidad_usada
         RETURNING *`,
        [id_examen, id_insumo, cantidad_usada]
      );

      // 2. Leer el tipo de muestra directamente del insumo
      const resInsumo = await client.query(
        `SELECT i.id_tipo_muestra, tm.nombre AS tipo_nombre
         FROM insumos i
         LEFT JOIN tipo_muestra tm ON i.id_tipo_muestra = tm.id_tipo_muestra
         WHERE i.id_insumo = $1`,
        [id_insumo]
      );
      const { id_tipo_muestra, tipo_nombre } = resInsumo.rows[0] || {};

      // 3. Si el insumo tiene tipo de muestra asignado, propagarlo
      //    a la tabla pivote examen_tipo_muestra del examen.
      if (id_tipo_muestra) {
        await client.query(
          `INSERT INTO examen_tipo_muestra (id_examen, id_tipo_muestra)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id_examen, id_tipo_muestra]
        );
      }

      // 4. Auditoría
      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'VINCULAR_RECETA',
         `Examen ID ${id_examen} → Insumo ID ${id_insumo} (${cantidad_usada} unidades)` +
         (tipo_nombre ? ` | Tipo muestra del insumo: "${tipo_nombre}"` : '')]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },

  // ════════════════════════════════════════════════════════
  // ALERTAS DE REABASTECIMIENTO
  // ════════════════════════════════════════════════════════

  // NOTA: las alertas se calculan EN VIVO comparando stock_actual vs
  // stock_minimo directo en la tabla insumos. Antes dependían de que
  // existiera una fila en "reabastecimiento" con estado PENDIENTE, pero
  // esa fila solo se creaba desde ajusteStockManual (movimiento manual) y
  // solo si la config notificarAlertasStock estaba activa. Si el stock
  // bajaba por cualquier otra vía (venta, consumo automático por receta de
  // examen, edición de stock_minimo, etc.) nunca se generaba la alerta y
  // la pestaña de Alertas quedaba vacía aunque el insumo estuviera en rojo.
  getAlertasReabastecimiento: async () => {
    const { rows } = await pool.query(`
      SELECT
        i.id_insumo,
        i.nombre              AS insumo,
        i.unidad_medida,
        i.stock_actual,
        i.stock_minimo,
        (i.stock_minimo - i.stock_actual) AS deficit,
        r.id_reporte,
        r.fecha_reporte,
        COALESCE(r.estado, 'PENDIENTE') AS estado
      FROM insumos i
      LEFT JOIN reabastecimiento r
        ON r.id_insumo = i.id_insumo
        AND r.estado = 'PENDIENTE'
      WHERE i.estado = TRUE
        AND i.stock_actual <= i.stock_minimo
      ORDER BY deficit DESC
    `);
    return rows;
  },

  // ════════════════════════════════════════════════════════
  // MOVIMIENTOS MANUALES
  // ════════════════════════════════════════════════════════

  ajusteStockManual: async (data, id_usuario) => {
    const { id_insumo, tipo_movimiento, cantidad, observacion } = data;

    if (!['ENTRADA', 'SALIDA'].includes(tipo_movimiento))
      throw new Error("tipo_movimiento debe ser ENTRADA o SALIDA");
    if (cantidad <= 0)
      throw new Error("La cantidad debe ser mayor a 0");

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (tipo_movimiento === 'SALIDA') {
        const { rows } = await client.query(
          'SELECT stock_actual, nombre FROM insumos WHERE id_insumo = $1', [id_insumo]
        );
        if (!rows[0]) throw new Error("Insumo no encontrado");
        if (rows[0].stock_actual < cantidad)
          throw new Error(`Stock insuficiente. Disponible: ${rows[0].stock_actual}`);
      }

      const sql = tipo_movimiento === 'ENTRADA'
        ? "UPDATE insumos SET stock_actual = stock_actual + $1 WHERE id_insumo = $2 RETURNING *"
        : "UPDATE insumos SET stock_actual = stock_actual - $1 WHERE id_insumo = $2 RETURNING *";

      const { rows: updated } = await client.query(sql, [cantidad, id_insumo]);

      await client.query(
        `INSERT INTO movimientos (id_insumo, id_usuario, tipo_movimiento, cantidad, observacion)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_insumo, id_usuario, tipo_movimiento, cantidad, observacion || null]
      );

      await client.query(
        "INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)",
        [id_usuario, 'MOVIMIENTO_STOCK',
         `${tipo_movimiento}: ${cantidad} unidades — Insumo ID ${id_insumo}. ${observacion || ''}`]
      );

      await client.query('COMMIT');
      return updated[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally    { client.release(); }
  },
};

module.exports = insumoModule;