import unittest
import time
from tools.orchestration.telegram_monitor import TelegramMonitor, TelegramMockTransport

class TestTelegramMonitor(unittest.TestCase):
    def setUp(self):
        self.mock_transport = TelegramMockTransport()
        self.monitor = TelegramMonitor(transport=self.mock_transport, authorized_chat_ids=["123456"], debounce_seconds=0.1)

    def test_start_command(self):
        res = self.monitor.handle_command("123456", "/start")
        self.assertTrue(res["ok"])
        self.assertEqual(self.mock_transport.send_count, 1)
        self.assertIn("ARENA CONTROL", self.mock_transport.messages[1])

    def test_unauthorized_chat(self):
        res = self.monitor.handle_command("999999", "/start")
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "UNAUTHORIZED_CHAT")

    def test_progress_single_live_message_and_editing(self):
        # 1. Send /progress creates live message
        res = self.monitor.handle_command("123456", "/progress")
        self.assertTrue(res["ok"])
        self.assertEqual(self.mock_transport.send_count, 1)
        self.assertEqual(self.monitor.live_message_id, 1)

        # 2. Event updates dashboard via editMessageText
        time.sleep(0.15) # respect debounce
        self.monitor.on_arena_event("TASK_CLAIMED", {"task_key": "runtime-kernel/m1-test"}, chat_id="123456")
        self.assertEqual(self.mock_transport.send_count, 1) # no new send
        self.assertEqual(self.mock_transport.edit_count, 1)  # edited message

        # 3. No edit if content has not changed (hash deduplication)
        time.sleep(0.15)
        updated = self.monitor.update_live_dashboard("123456")
        self.assertFalse(updated)
        self.assertEqual(self.mock_transport.edit_count, 1)

    def test_polling_process_updates_and_offset_advance(self):
        # Enqueue mock updates
        self.mock_transport.pending_updates = [
            {
                "update_id": 101,
                "message": {"chat": {"id": 123456}, "text": "/start"}
            },
            {
                "update_id": 102,
                "message": {"chat": {"id": 123456}, "text": "/progress"}
            }
        ]
        # First process call with offset=None
        next_offset = self.monitor.process_updates(offset=None, timeout=1)
        self.assertEqual(next_offset, 103)
        self.assertEqual(self.mock_transport.send_count, 2)

        # Second process call with offset=103 should process nothing new
        next_offset_2 = self.monitor.process_updates(offset=next_offset, timeout=1)
        self.assertEqual(next_offset_2, 103)
        self.assertEqual(self.mock_transport.send_count, 2)

    def test_unknown_command_resilience(self):
        self.mock_transport.pending_updates = [
            {
                "update_id": 201,
                "message": {"chat": {"id": 123456}, "text": "/unknown_foo"}
            }
        ]
        next_offset = self.monitor.process_updates(offset=None, timeout=1)
        self.assertEqual(next_offset, 202)
        # Process did not crash and handled gracefully

    def test_unauthorized_chat_in_polling(self):
        self.mock_transport.pending_updates = [
            {
                "update_id": 301,
                "message": {"chat": {"id": 999999}, "text": "/start"}
            }
        ]
        next_offset = self.monitor.process_updates(offset=None, timeout=1)
        self.assertEqual(next_offset, 302)
        self.assertEqual(self.mock_transport.send_count, 0) # Ignored/rejected

    def test_canonical_snapshot_identity(self):
        # Ensure render_start and render_progress use the exact same project_state
        self.monitor.project_state["done_tasks"] = 11
        self.monitor.project_state["queued_tasks"] = 38
        self.monitor.project_state["working_tasks"] = 0

        start_text = self.monitor.render_start()
        progress_text = self.monitor.render_progress()

        self.assertIn("11 DONE", start_text)
        self.assertIn("38 QUEUED", start_text)
        self.assertIn("11 completed", progress_text)
        self.assertIn("38 queued", progress_text)

if __name__ == "__main__":
    unittest.main()
