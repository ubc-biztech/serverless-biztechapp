const path = require('path');
const slsw = require('serverless-webpack');

module.exports = {
  entry: slsw.lib.entries,
  target: 'node',
  mode: 'production',
  externals: [/(aws-sdk)/], // exclude AWS SDK from the bundle (it is available in the Lambda runtime)
  optimization: {
    minimize: false, // Set to true for production builds to enable minification
  },
  resolve: {
    extensions: ['.js', '.json'], // Resolve these extensions
  },
  module: {
    rules: [
      {
        test: /\.js$/, // Apply this rule to JavaScript files
        exclude: /node_modules/, // Exclude node_modules from transpiling
        use: {
          loader: 'babel-loader', // Use babel-loader for transpiling JavaScript
          options: {
            presets: ['@babel/preset-env'], // Use the preset-env for ECMAScript features
          },
        },
      },
    ],
  },
  output: {
    libraryTarget: 'commonjs2', // Lambda expects commonjs2 for the module format
    path: path.join(__dirname, '.webpack'), // Output directory
    filename: '[name].js', // Output filename pattern
  },
};
