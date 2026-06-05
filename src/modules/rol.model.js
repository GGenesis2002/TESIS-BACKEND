// model/Rol.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db'); // Ajusta la ruta a tu conexión de BD

const Rol = sequelize.define('Rol', {
  id_rol: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  descripcion: {
    type: DataTypes.STRING(255)
  }
}, {
  tableName: 'rol',
  timestamps: false // Tu SQL no tiene campos de fecha en 'rol', así que desactivamos timestamps
});

module.exports = Rol;