"""
Telegram Mini App button configurations and utilities.
This module handles the web_app button integration for launching the Mini App.
"""

from typing import Dict, List, Any
import os

MINIAPP_URL = os.getenv("MINIAPP_URL", "https://ton-url.netlify.app")


def get_miniapp_keyboard() -> Dict[str, List[List[Dict[str, Any]]]]:
    """
    Generate the inline keyboard with a single web_app button.
    This opens the Telegram Mini App.
    
    Returns:
        Dictionary with 'inline_keyboard' containing button configuration
    """
    return {
        "inline_keyboard": [
            [
                {
                    "text": "🚀 Ouvrir la Mini App",
                    "web_app": {
                        "url": MINIAPP_URL
                    }
                }
            ]
        ]
    }


def get_miniapp_url_only() -> str:
    """
    Get just the Mini App URL for configuration or debugging.
    
    Returns:
        The Mini App URL as configured
    """
    return MINIAPP_URL


def create_miniapp_button(button_text: str = "🚀 Ouvrir la Mini App", url: str = None) -> Dict[str, Any]:
    """
    Create a single web_app button configuration.
    
    Args:
        button_text: The display text for the button
        url: Optional custom URL (uses env var if not provided)
    
    Returns:
        Button configuration dictionary
    """
    return {
        "text": button_text,
        "web_app": {
            "url": url or MINIAPP_URL
        }
    }
