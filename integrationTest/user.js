// params = {
//     FunctionName: "biztechApp-dev-userGetAll",
//   }
//   await lambda.invoke(params, function(err, data) {
//     if (err) {
//       console.log(err);
//       throw err;
//     }
//     else console.log(data);
//     console.log("ASDSADASDASDASD");
//   });

//   let event= {};
//   event.pathParameters = { };
//   event.pathParameters.id = 144444;
//   params = {
//     FunctionName: "biztechApp-dev-userGet",
//     Payload: JSON.stringify( event ) 
//   }
//   await lambda.invoke(params, function(err, data) {
//     if (err) {
//       console.log(err);
//       throw err;
//     }
//     else console.log(data);
//     console.log("ASDSADASDASDASD");
//   }
// );