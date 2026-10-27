interface VaultNameSettingsOwner {
  settings: { vault: string }
  wsSettingChange: boolean
  localStorageManager: { clearSyncTime(): void }
  saveAndReloadServices(): Promise<void>
}

export async function updateVaultName(plugin: VaultNameSettingsOwner, value: string): Promise<void> {
  if (value === plugin.settings.vault) return

  plugin.wsSettingChange = true
  plugin.settings.vault = value
  plugin.localStorageManager.clearSyncTime()
  await plugin.saveAndReloadServices()
}

