{{/*
Expand the name of the chart.
*/}}
{{- define "gatewaze.name" -}}
{{- default .Chart.Name .Values.instanceName | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 characters because some Kubernetes name fields are limited.
*/}}
{{- define "gatewaze.fullname" -}}
{{- if .Values.instanceName }}
{{- .Values.instanceName | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.instanceName }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "gatewaze.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "gatewaze.labels" -}}
helm.sh/chart: {{ include "gatewaze.chart" . }}
{{ include "gatewaze.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "gatewaze.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gatewaze.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "gatewaze.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "gatewaze.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Redis URL — internal or external
*/}}
{{- define "gatewaze.redisUrl" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://:%s@%s-redis:6379" .Values.redis.password (include "gatewaze.fullname" .) }}
{{- else }}
{{- .Values.redis.externalUrl }}
{{- end }}
{{- end }}

{{/*
Image tag — defaults to Chart.AppVersion when image.tag is empty.
Rejects `latest` to avoid non-deterministic rollbacks (spec §5.9 /
PR-M-5).
*/}}
{{- define "gatewaze.imageTag" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- if eq $tag "latest" -}}
{{- fail "image.tag=latest is forbidden — pin to a semver or git-SHA tag (spec §5.9)" -}}
{{- end -}}
{{- $tag -}}
{{- end -}}
