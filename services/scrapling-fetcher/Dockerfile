# The tag must track the playwright version scrapling[fetchers] pins
# (1.58.0), because the browsers baked into this image are built for exactly
# that version. On v1.49.0-noble the shipped browsers were chromium-1148 while
# scrapling wanted 1.58, and the image carried no playwright package at all,
# so every browser-mode request 500'd on ModuleNotFoundError.
FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app

COPY requirements.txt .
# --break-system-packages: this base image marks its system python as
# externally managed (PEP 668), and the service is the only thing in the
# container, so installing into it is what we want.
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ /app/app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
