module.exports = {

  isEmpty: function(obj) {

    if (obj === null  || obj === undefined) return true;
    if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0;
    return Object.keys(obj).length === 0;

  }

};
