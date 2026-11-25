"""Split planner source-contract regression tests; no model downloads."""
import unittest

import torch
from torch import nn

from designed_tts.browser_export import VocaPlan


class ConstantDuration(nn.Module):
    def forward(self, hidden, mask):
        return torch.stack((torch.full_like(mask, 10., dtype=torch.float32),
                            torch.full_like(mask, -1., dtype=torch.float32)), -1)


class IdentityEncoder(nn.Module):
    def forward(self, hidden, mask):
        return hidden


class BrowserPlannerTests(unittest.TestCase):
    def test_voca_duration_cap_matches_original_log1p_400(self):
        model = nn.Module()
        model.tokens = nn.Embedding(3, 2)
        model.stress = nn.Embedding(3, 2)
        model.voices = nn.Embedding(1, 2)
        model.encoder = IdentityEncoder()
        model.duration = ConstantDuration()
        model.register_buffer("phone_tokens", torch.tensor([False, True, False]))
        _, durations = VocaPlan(model)(torch.tensor([[0, 1, 2]]), torch.zeros(1, 3, dtype=torch.long), torch.tensor([0]))
        self.assertEqual(durations.tolist(), [[0, 400, 0]])


if __name__ == "__main__":
    unittest.main()
