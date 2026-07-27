// Captures the func-mpc-poc Function App's Run-From-Package setting as
// code for future re-provisioning. Applying this is a manual, GCC-side
// action (`az deployment group create ...`) — it is not run by CI and
// does not change how deploys are built or pushed. See the "Deployment"
// section of README.md for what Run-From-Package means operationally.
//
// The `Microsoft.Web/sites/config` (name: 'appsettings') resource
// REPLACES the entire app-settings dictionary if deployed directly —
// this template reads the Function App's existing settings via the
// `list()` ARM function first and merges WEBSITE_RUN_FROM_PACKAGE onto
// them, so it never clobbers unrelated settings (STORAGE_CONNECTION,
// MODERNGOV_ENDPOINT, etc.) already configured on the app.
//
// Usage (from the resource group containing the existing Function App):
//   az deployment group create \
//     --resource-group <resource-group> \
//     --template-file infra/function-app-settings.bicep \
//     --parameters functionAppName=func-mpc-poc

@description('Name of the existing Function App to configure. Must already exist — this template only merges an app setting onto it, it does not create the app.')
param functionAppName string = 'func-mpc-poc'

resource functionApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: functionAppName
}

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: union(
    list('${functionApp.id}/config/appsettings', '2023-12-01').properties,
    {
      WEBSITE_RUN_FROM_PACKAGE: '1'
    }
  )
}
