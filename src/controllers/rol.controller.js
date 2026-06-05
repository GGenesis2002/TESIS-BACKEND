// controller/rol.controller.js
const Rol = require('../model/Rol');

const obtenerRoles = async (req, res) => {
  try {
    const listaRoles = await Rol.findAll({ order: [['id_rol', 'ASC']] });
    
    // Transformamos la respuesta al formato que espera el Frontend
    const rolesMapeados = listaRoles.map(rol => ({
      label: rol.nombre,
      value: String(rol.id_rol) // Siempre en String para evitar fallos de tipo en React
    }));

    res.json(rolesMapeados);
  } catch (error) {
    console.error('Error al obtener roles:', error);
    res.status(500).json({ error: 'Error interno del servidor al recuperar los roles.' });
  }
};

module.exports = { obtenerRoles };