module.exports = {
    // Alphabetical sorter, a -z
    alphabeticalSorter: (property) => (a, b) => {
        let top, bot;
        if(property) {
            top = a[property] ? a[property].toLowerCase() : '';
            bot = b[property] ? b[property].toLowerCase() : '';
        }
        else {
            top = a ? a.toLowerCase : '';
            bot = b ? b.toLowerCase : '';
        }
        return top !== bot ? (top > bot ? 1 : -1 ) : 0;
    },
    // Date sorter, putting the most 'recent' at the start
    dateSorter: (property) => (a, b) => {
        let top, bot;
        if(property) {
            top = a[property] ? new Date(a[property]) : 0;
            bot = b[property] ? new Date(b[property]) : 0;
        }
        else {
            top = a ? new Date(a) : 0;
            bot = b ? new Date(b) : 0;
        }
        return bot - top;
    }
}