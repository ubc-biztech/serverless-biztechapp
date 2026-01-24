-- Project-specific Neovim configuration for serverless-biztechapp
-- This file configures ESLint language server alongside ts_ls

-- Get the root directory (where this .nvim.lua file is located)
local root_dir = vim.fn.getcwd()

-- Helper function to check if LSP client is already attached
local function is_client_attached(client_name)
  local clients = vim.lsp.get_active_clients()
  for _, client in ipairs(clients) do
    if client.name == client_name then
      return true
    end
  end
  return false
end

-- Configure ts_ls to disable diagnostics but keep other features
vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if client and client.name == "ts_ls" then
      -- Disable diagnostics from ts_ls
      client.server_capabilities.documentFormattingProvider = false
      vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(
        function(_, result, ctx, config)
          local client_id = ctx.client_id
          local ts_client = vim.lsp.get_client_by_id(client_id)
          if ts_client and ts_client.name == "ts_ls" then
            -- Suppress ts_ls diagnostics
            return
          end
          -- Let other LSPs publish diagnostics normally
          vim.lsp.diagnostic.on_publish_diagnostics(_, result, ctx, config)
        end,
        {}
      )
    end
  end,
})

-- Setup ESLint language server if not already attached
vim.defer_fn(function()
  if not is_client_attached("eslint") then
    -- Check if eslint LSP is available
    local eslint_config = {
      cmd = { "vscode-eslint-language-server", "--stdio" },
      filetypes = { "javascript", "javascriptreact", "javascript.jsx", "typescript", "typescriptreact", "typescript.tsx", "vue" },
      root_dir = root_dir,
      settings = {
        codeAction = {
          disableRuleComment = {
            enable = true,
            location = "separateLine"
          },
          showDocumentation = {
            enable = true
          }
        },
        codeActionOnSave = {
          enable = false,
          mode = "all"
        },
        format = false,
        nodePath = "",
        onIgnoredFiles = "off",
        packageManager = "npm",
        quiet = false,
        rulesCustomizations = {},
        run = "onType",
        useESLintClass = false,
        validate = "on",
        workingDirectory = {
          mode = "location"
        }
      },
      on_attach = function(client, bufnr)
        -- Enable auto-fix on save (optional - uncomment if desired)
        -- vim.api.nvim_create_autocmd("BufWritePre", {
        --   buffer = bufnr,
        --   command = "EslintFixAll",
        -- })
        
        print("ESLint LSP attached for serverless-biztechapp")
      end,
    }

    -- Start the ESLint language server
    vim.lsp.start(eslint_config)
  end
end, 500) -- Small delay to ensure ts_ls is loaded first

print("Loaded serverless-biztechapp project config (.nvim.lua)")
