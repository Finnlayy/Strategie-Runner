"""
=========================================================
Datei:      app/execution/TransientOrderBuffer.py (v1.5.5)
Zweck:      Transiente Order-Pufferung via nativer Redis TTL
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("app.execution.transient_buffer")

class TransientOrderBuffer:
    def __init__(self, redis_client, default_grace_period_seconds: int = 10):
        self.redis = redis_client
        self.grace_period = default_grace_period_seconds

    async def save_pending_intent(self, instance_id: str, order_intent: Dict[str, Any]) -> None:
        if not self.redis:
            return
        key = f"m8:pending_intent:{instance_id}"
        payload = {"intent": order_intent}
        await self.redis.set(key, json.dumps(payload), ex=self.grace_period)

    async def get_and_validate_intent(
        self, instance_id: str, current_market_price: float, max_allowed_drift_pct: float = 0.0015
    ) -> Optional[Dict[str, Any]]:
        if not self.redis:
            return None
        key = f"m8:pending_intent:{instance_id}"
        raw_data = await self.redis.get(key)
        if not raw_data:
            return None

        data = json.loads(raw_data)
        intent = data["intent"]
        original_price = float(intent.get("price", 0.0))
        if original_price > 0:
            drift = abs(current_market_price - original_price) / original_price
            if drift > max_allowed_drift_pct:
                await self.redis.delete(key)
                return None

        await self.redis.delete(key)
        return intent
