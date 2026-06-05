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
      }
      
      config[row.clave] = valorFormateado;
    });

    return config;
  } catch (error) {
    console.error("Error al obtener la configuración desde la BD:", error);
    return {
      expiracionQR: 2,
      bloqueoEdicion: true,
      auditoriaEstricta: true,
      notificarAlertasStock: true,
      reintentosLogin: 5,
    };
  }
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

    // Iterar sobre cada propiedad del objeto y actualizar su respectiva clave en la BD
    for (const [clave, valor] of Object.entries(datos)) {
      await client.query(
        'UPDATE configuracion_sistema SET valor = $1 WHERE clave = $2',
        [String(valor), clave]
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
  actualizarConfiguracion
};