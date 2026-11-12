"""Testes da fila de jobs (`app.jobs`) com um cliente Supabase falso.

A função SQL `claim_job` (atomicidade, heartbeat velho, limite de tentativas)
é exercitada à parte contra um Postgres real; aqui fica a lógica Python em
volta dela: enfileirar, executar, finalizar e degradar sem a fila.
"""
import threading

import pytest

from app import jobs, main, pipeline
from app.config import settings


class _Query:
    def __init__(self, client, table):
        self.client, self.table, self.op, self.values, self.filters = (
            client, table, "select", None, [],
        )

    def select(self, *_a):
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def in_(self, col, vals):
        self.filters.append((col, tuple(vals)))
        return self

    def limit(self, _n):
        return self

    def execute(self):
        if self.client.broken:
            raise RuntimeError("relation jobs does not exist")
        self.client.calls.append((self.table, self.op, self.values, self.filters))
        data = self.client.live if self.op == "select" else []
        return type("R", (), {"data": data})()


class FakeClient:
    def __init__(self, queue=None, broken=False, live=None):
        self.queue, self.broken, self.live, self.calls = (
            list(queue or []), broken, live or [], [],
        )

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        client = self

        class _Rpc:
            def execute(self):
                client.calls.append(("rpc", name, params, []))
                row = client.queue.pop(0) if client.queue else None
                return type("R", (), {"data": [row] if row else []})()

        return _Rpc()


@pytest.fixture
def fake(monkeypatch):
    def _install(**kwargs):
        client = FakeClient(**kwargs)
        monkeypatch.setattr(jobs, "get_client", lambda: client)
        return client

    monkeypatch.setattr(settings, "job_heartbeat_seconds", 60)
    return _install


def _ops(client, op):
    return [c for c in client.calls if c[1] == op]


def test_enqueue_inserts_job_with_payload(fake):
    client = fake()
    assert jobs.enqueue("p1", {"max_cuts": 10}) is True
    (_table, _op, values, _f), = _ops(client, "insert")
    assert values == {"project_id": "p1", "kind": "process", "payload": {"max_cuts": 10}}


def test_enqueue_skips_duplicate_when_project_has_live_job(fake):
    client = fake(live=[{"id": "j0"}])
    assert jobs.enqueue("p1", {}) is True
    assert _ops(client, "insert") == []


def test_enqueue_returns_false_when_queue_is_unavailable(fake):
    fake(broken=True)
    assert jobs.enqueue("p1", {}) is False


def test_claim_ignores_all_null_row(fake):
    fake(queue=[{"id": None, "project_id": None}])
    assert jobs.claim() is None


def test_run_one_marks_done_and_only_touches_own_running_job(fake):
    client = fake(queue=[{"id": "j1", "project_id": "p1", "attempts": 1}])
    seen = []
    assert jobs.run_one(lambda job: seen.append(job["id"]) or True) is True
    assert seen == ["j1"]
    (_t, _op, values, filters), = _ops(client, "update")
    assert values["status"] == "done" and values["error"] is None
    assert ("worker_id", jobs.WORKER_ID) in filters and ("status", "running") in filters


def test_run_one_marks_error_when_handler_fails_or_raises(fake):
    client = fake(queue=[
        {"id": "j1", "project_id": "p1", "attempts": 1},
        {"id": "j2", "project_id": "p2", "attempts": 1},
    ])

    def boom(_job):
        raise ValueError("vídeo corrompido")

    assert jobs.run_one(lambda _job: False) is True
    assert jobs.run_one(boom) is True
    first, second = [c[2] for c in _ops(client, "update")]
    assert first["status"] == "error"
    assert second["status"] == "error" and "vídeo corrompido" in second["error"]


def test_run_one_returns_false_on_empty_queue(fake):
    fake()
    assert jobs.run_one(lambda _job: True) is False


def test_heartbeat_renews_while_job_runs(fake, monkeypatch):
    monkeypatch.setattr(settings, "job_heartbeat_seconds", 0.01)
    client = fake(queue=[{"id": "j1", "project_id": "p1", "attempts": 1}])
    beat = threading.Event()

    def slow(_job):
        # espera até o heartbeat aparecer (ou 2 s) antes de terminar
        for _ in range(200):
            if any("heartbeat_at" in (c[2] or {}) for c in _ops(client, "update")):
                beat.set()
                break
            threading.Event().wait(0.01)
        return True

    jobs.run_one(slow)
    assert beat.is_set()


def test_run_job_maps_payload_and_flags_retry(monkeypatch):
    captured = {}

    def fake_process(project_id, *args, **kwargs):
        captured.update(project_id=project_id, args=args, kwargs=kwargs)
        return True

    monkeypatch.setattr(pipeline, "process_project", fake_process)
    ok = pipeline.run_job({
        "project_id": "p1",
        "attempts": 2,
        "payload": {"limit_seconds": 3600, "max_cuts": 10, "cut_style": "dynamic",
                    "ai_tier": "lite", "cut_intensity": "intense"},
    })
    assert ok is True
    assert captured["args"] == (3600, 10, "dynamic", "lite", "intense")
    assert captured["kwargs"] == {"retry": True}


def test_process_endpoint_enqueues_and_falls_back_to_background(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, "worker_secret", "s3")
    ran, queued = [], []
    monkeypatch.setattr(main, "process_project", lambda *a: ran.append(a))
    client = TestClient(main.app)
    body = {"project_id": "p1", "max_cuts": 5, "cut_style": "dynamic"}

    assert client.post("/process", json=body).status_code == 401

    monkeypatch.setattr(main.jobs, "enqueue", lambda pid, payload: queued.append((pid, payload)) or True)
    assert client.post("/process", json=body, headers={"x-worker-secret": "s3"}).status_code == 202
    assert queued[0][0] == "p1" and queued[0][1]["max_cuts"] == 5
    assert "project_id" not in queued[0][1] and ran == []

    monkeypatch.setattr(main.jobs, "enqueue", lambda pid, payload: False)
    assert client.post("/process", json=body, headers={"x-worker-secret": "s3"}).status_code == 202
    assert ran and ran[0][0] == "p1"
