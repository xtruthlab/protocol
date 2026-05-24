// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/interfaces/ExpandedIERC20.sol";

/**
 * @title XtrFaucet
 * @notice Testnet faucet for the XTR voting token. Anyone can call `drip()`
 * (mint to self) or `dripTo(recipient)` (mint to any address, like the OKX
 * faucet) once per `cooldown` per recipient, getting a fixed `dripAmount` of
 * XTR so they can try staking / voting in the DVM. The faucet must hold the
 * token's Minter role — call `xtr.addMinter(faucet)` once after deployment.
 *
 * Testnet only: there is no supply cap and no owner gate on dripping by
 * design. Do NOT grant this contract the Minter role on a production token.
 */
contract XtrFaucet {
    ExpandedIERC20 public immutable token;
    uint256 public immutable dripAmount;
    uint256 public immutable cooldown;

    // recipient => unix timestamp of their last drip (0 = never).
    mapping(address => uint256) public lastDrip;

    // Aggregate status counters, surfaced by faucet UIs.
    uint256 public totalDripped; // cumulative XTR minted by this faucet
    uint256 public dripCount; // number of successful drips

    event Dripped(address indexed recipient, address indexed caller, uint256 amount);

    constructor(
        ExpandedIERC20 _token,
        uint256 _dripAmount,
        uint256 _cooldown
    ) {
        token = _token;
        dripAmount = _dripAmount;
        cooldown = _cooldown;
    }

    /**
     * @notice Mint `dripAmount` XTR to the caller. Reverts if the caller dripped
     * within the last `cooldown`.
     */
    function drip() external {
        _drip(msg.sender);
    }

    /**
     * @notice Mint `dripAmount` XTR to `recipient` (OKX-style: send to any
     * address). Cooldown is tracked per recipient, so this can't be used to
     * spam a single address faster than the cooldown.
     */
    function dripTo(address recipient) external {
        _drip(recipient);
    }

    function _drip(address recipient) internal {
        require(recipient != address(0), "XtrFaucet: zero recipient");
        require(block.timestamp >= nextDripTime(recipient), "XtrFaucet: cooldown active");
        lastDrip[recipient] = block.timestamp;
        totalDripped += dripAmount;
        dripCount += 1;
        require(token.mint(recipient, dripAmount), "XtrFaucet: mint failed");
        emit Dripped(recipient, msg.sender, dripAmount);
    }

    /**
     * @notice Timestamp at which `user` may receive a drip again. Returns 0 for
     * an address that has never received one (i.e. it can drip immediately).
     */
    function nextDripTime(address user) public view returns (uint256) {
        uint256 last = lastDrip[user];
        return last == 0 ? 0 : last + cooldown;
    }
}
