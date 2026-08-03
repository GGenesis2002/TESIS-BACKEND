const pool = require('../config/db');

// Función auxiliar para obtener la configuración como un objeto JS legible
async function getConfig() {
  try {
    const { rows } = await pool.query('SELECT clave, valor, tipo FROM configuracion_sistema');

    if (rows.length === 0) {
      // Valores por defecto si la tabla estuviera vacía
      return {
        expiracionQR: 2,
        bloqueoEdicion: true,
        auditoriaEstricta: true,
        notificarAlertasStock: true,
        reintentosLogin: 5,
        correosCierreCaja: [],
      };
    }

    // Convertimos las filas (clave, valor) de la BD a un objeto estructurado
    const config = {};
    rows.forEach(row => {
      let valorFormateado = row.valor;

      // Parsear el string de la BD a su tipo de dato correspondiente
      if (row.tipo === 'number') {
        valorFormateado = Number(row.valor);
      } else if (row.tipo === 'boolean') {
        valorFormateado = row.valor === 'true' || row.valor === true;
      } else if (row.tipo === 'json') {
        // Usado para listas, p.ej. los correos a los que se envía el
        // reporte de cierre de caja.
        try {
          valorFormateado = JSON.parse(row.valor);
        } catch {
          valorFormateado = [];
        }
      }

      config[row.clave] = valorFormateado;
    });

    // Si todavía no existe la clave en BD (primera vez que se usa la
    // funcionalidad), devolvemos una lista vacía en vez de undefined.
    if (!('correosCierreCaja' in config)) {
      config.correosCierreCaja = [];
    }

    return config;
  } catch (error) {
    console.error("Error al obtener la configuración desde la BD:", error);
    return {
      expiracionQR: 2,
      bloqueoEdicion: true,
      auditoriaEstricta: true,
      notificarAlertasStock: true,
      reintentosLogin: 5,
      correosCierreCaja: [],
    };
  }
}

// Devuelve solo la lista de correos configurados para recibir el reporte de
// cierre de caja, ya filtrada de valores vacíos. Pensada para ser usada
// desde cajaController al cerrar un turno.
async function obtenerCorreosCierreCaja() {
  const config = await getConfig();
  const correos = config.correosCierreCaja;
  return Array.isArray(correos) ? correos.filter(c => typeof c === 'string' && c.trim() !== '') : [];
}

// Endpoint GET: Enviar la configuración al Frontend
const obtenerConfiguracion = async (req, res) => {
  try {
    const data = await getConfig();
    res.json({ status: 'success', data });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Endpoint PUT: Actualizar la tabla en la Base de Datos
const actualizarConfiguracion = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const datos = req.body; // Recibe el objeto modificado desde el Frontend

    // Iterar sobre cada propiedad del objeto y guardar su respectiva clave en la BD.
    // Se usa INSERT ... ON CONFLICT en vez de un UPDATE plano porque claves nuevas
    // (como correosCierreCaja, agregada para las notificaciones de cierre de caja)
    // todavía no existen como fila en la tabla. Esto requiere que `clave` sea
    // PRIMARY KEY o tenga una restricción UNIQUE en configuracion_sistema.
    for (const [clave, valor] of Object.entries(datos)) {
      const esLista = Array.isArray(valor);
      const valorGuardado = esLista ? JSON.stringify(valor) : String(valor);
      const tipo = esLista
        ? 'json'
        : (typeof valor === 'number' ? 'number' : (typeof valor === 'boolean' ? 'boolean' : 'string'));

      await client.query(
        `INSERT INTO configuracion_sistema (clave, valor, tipo)
         VALUES ($1, $2, $3)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, tipo = EXCLUDED.tipo`,
        [clave, valorGuardado, tipo]
      );
    }

    await client.query('COMMIT');

    // Recuperar los datos frescos para confirmar el cambio
    const nuevaConfig = await getConfig();
    res.json({ status: 'success', data: nuevaConfig });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error al actualizar la configuración en la BD:", e);
    res.status(500).json({ status: 'error', message: e.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getConfig,
  obtenerConfiguracion,
  actualizarConfiguracion,
  obtenerCorreosCierreCaja,
};