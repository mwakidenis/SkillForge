using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SkillForgeTray.Models;

namespace SkillForgeTray.Services;

/// <summary>
/// Background polling &amp; event-fetching client querying http://127.0.0.1:48921/status every 1000ms,
/// with graceful offline handling when the daemon is stopped.
/// </summary>
public class IpcClientService : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl = "http://127.0.0.1:48921";
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public event Func<DaemonStatusDto, Task>? StatusChanged;
    public event Func<bool, Task>? OfflineChanged;

    private bool _lastOnline = true;

    public IpcClientService()
    {
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(2),
        };
    }

    public async Task<DaemonStatusDto?> FetchStatusAsync(CancellationToken ct = default)
    {
        try
        {
            var resp = await _httpClient.GetAsync($"{_baseUrl}/status", ct);
            if (!resp.IsSuccessStatusCode)
            {
                HandleOffline();
                return null;
            }
            var json = await resp.Content.ReadAsStringAsync(ct);
            var dto = JsonSerializer.Deserialize<DaemonStatusDto>(json, _jsonOptions);
            HandleOnline();
            return dto;
        }
        catch
        {
            HandleOffline();
            return null;
        }
    }

    public async Task<bool> TriggerEmergencyRollbackAsync(CancellationToken ct = default)
    {
        try
        {
            var resp = await _httpClient.PostAsync($"{_baseUrl}/rollback/latest", null, ct);
            return resp.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private void HandleOffline()
    {
        if (_lastOnline)
        {
            _lastOnline = false;
            _ = OfflineChanged?.Invoke(false);
        }
    }

    private void HandleOnline()
    {
        if (!_lastOnline)
        {
            _lastOnline = true;
            _ = OfflineChanged?.Invoke(true);
        }
    }

    public void Dispose()
    {
        _httpClient.Dispose();
    }
}
