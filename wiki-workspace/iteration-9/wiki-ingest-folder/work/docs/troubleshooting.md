# Troubleshooting

If you see 502 errors, check the gateway pod first; if logs show DB timeouts, look at the Postgres connection pool saturation gauge in Grafana.
